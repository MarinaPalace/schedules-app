"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { departmentManagers, departments, employees, jobRoles, locations, shiftTemplates, user } from "@/db/schema";
import { withActor, type Tx } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { assertRole, PEOPLE_ADMINS } from "@/lib/session";
import { AppError } from "@/lib/app-error";
import { sendPasswordLink } from "@/lib/account-links";
import { errorMessage } from "@/lib/errors";
import type { LinkResult } from "@/lib/link-result";
import { LEGEND_PRESETS, ROLE_PRESETS, type PresetGroup } from "@/lib/presets";
import { getDefaultLocale } from "@/lib/settings";
import { paidMinutes, parseSegments } from "@/lib/shifts";
import { createLogin, randomPassword } from "@/lib/users";

const ADMINS = PEOPLE_ADMINS;
const nameSchema = z.string().trim().min(2, "nameTooShort");

export async function createDepartment(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const name = nameSchema.parse(form.get("name"));
    await withActor(me.id, (tx) => tx.insert(departments).values({ name }));
    revalidatePath("/admin/departments");
    return (await getTranslations("departments"))("created", { name });
  });
}

export async function updateDepartment(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const id = z.uuid().parse(form.get("id"));
    const name = nameSchema.parse(form.get("name"));
    const active = form.get("active") === "on";
    await withActor(me.id, (tx) => tx.update(departments).set({ name, active }).where(eq(departments.id, id)));
    revalidatePath("/admin/departments");
  });
}

/** Replaces the set of managers for a department (rows are deactivated, never deleted). */
export async function setDepartmentManagers(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const departmentId = z.uuid().parse(form.get("departmentId"));
    const wanted = new Set(form.getAll("managerIds").map(String));

    await withActor(me.id, async (tx) => {
      const managers = await tx.select({ id: user.id }).from(user).where(inArray(user.role, ["manager", "top_manager"]));
      const valid = new Set(managers.map((m) => m.id));
      const current = await tx.select().from(departmentManagers).where(eq(departmentManagers.departmentId, departmentId));

      for (const row of current) {
        const shouldBeActive = wanted.has(row.userId);
        if (row.active !== shouldBeActive) {
          await tx
            .update(departmentManagers)
            .set({ active: shouldBeActive })
            .where(and(eq(departmentManagers.userId, row.userId), eq(departmentManagers.departmentId, departmentId)));
        }
      }
      const existing = new Set(current.map((r) => r.userId));
      for (const userId of wanted) {
        if (!existing.has(userId) && valid.has(userId)) {
          await tx.insert(departmentManagers).values({ userId, departmentId });
        }
      }
    });
    revalidatePath("/admin/departments");
    return (await getTranslations("departments"))("managersUpdated");
  });
}

// ---- Department wizard (owner/GM): one step instead of three pages ----


const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null);

/** A new manager for a department: login (manager) + employee record there + assignment. Returns the login id. */
async function addNewManager(tx: Tx, departmentId: string, form: FormData) {
  const first = optionalText.parse(form.get("mFirst") ?? "");
  const last = optionalText.parse(form.get("mLast") ?? "");
  if (!first && !last) return null;
  if (!first || !last) throw new AppError("nameTooShort");
  const email = optionalText.parse(form.get("mEmail") ?? "");
  const contactEmail = email ? z.email("emailFormat").parse(email) : null;
  const userId = await createLogin(tx, {
    username: String(form.get("mUsername") ?? ""),
    password: randomPassword(),
    name: `${first} ${last}`,
    role: "manager",
    contactEmail,
  });
  await tx.insert(employees).values({ firstName: first, lastName: last, departmentId, userId });
  await tx.insert(departmentManagers).values({ userId, departmentId });
  return userId;
}

export async function createDepartmentWizard(_: LinkResult, form: FormData): Promise<LinkResult> {
  try {
    const me = await assertRole(ADMINS);
    const name = nameSchema.parse(form.get("name"));
    const preset = z.enum(["", "fnb", "housekeeping", "frontOffice", "kitchen"]).catch("").parse(form.get("preset") ?? "");
    const copyFrom = optionalText.parse(form.get("copyFrom") ?? "");
    const managerIds = form.getAll("managerIds").map(String);
    const withLegends = form.get("legends") === "on";
    const locale = await getDefaultLocale();

    const newManager = await withActor(me.id, async (tx) => {
      const [dept] = await tx.insert(departments).values({ name }).returning();
      const roleNames = new Set<string>();
      if (preset) for (const n of ROLE_PRESETS[preset as PresetGroup][locale]) roleNames.add(n);
      if (copyFrom) {
        const [srcRoles, srcPlaces] = await Promise.all([
          tx.select().from(jobRoles).where(and(eq(jobRoles.departmentId, copyFrom), eq(jobRoles.active, true))),
          tx.select().from(locations).where(and(eq(locations.departmentId, copyFrom), eq(locations.active, true))),
        ]);
        for (const r of srcRoles.sort((a, b) => a.sort - b.sort)) roleNames.add(r.name);
        if (srcPlaces.length) {
          await tx.insert(locations).values(srcPlaces.map((l) => ({ departmentId: dept.id, name: l.name, code: l.code, sort: l.sort })));
        }
      }
      if (roleNames.size) await tx.insert(jobRoles).values([...roleNames].map((n, i) => ({ departmentId: dept.id, name: n, sort: i + 1 })));
      if (withLegends) {
        // Legend codes are hotel-wide: a common legend that already exists isn't added twice.
        const taken = new Set((await tx.select({ code: shiftTemplates.code }).from(shiftTemplates)).map((x) => x.code));
        const add = LEGEND_PRESETS.filter((l) => !taken.has(l.code)).map((l) => {
          const segments = parseSegments(l.segments)!;
          return { code: l.code, name: l.name[locale], color: l.color, segments, breakMinutes: l.breakMinutes, paidMinutes: paidMinutes(segments, l.breakMinutes), departmentId: dept.id };
        });
        if (add.length) await tx.insert(shiftTemplates).values(add);
      }
      const valid = managerIds.length
        ? (await tx.select({ id: user.id }).from(user).where(and(inArray(user.id, managerIds), inArray(user.role, ["manager", "top_manager"])))).map((u) => u.id)
        : [];
      if (valid.length) await tx.insert(departmentManagers).values(valid.map((userId) => ({ userId, departmentId: dept.id })));
      return addNewManager(tx, dept.id, form);
    });
    revalidatePath("/admin/departments");
    const t = await getTranslations("departments");
    const ok = t("createdNext", { name });
    return newManager ? { ok, ...(await sendPasswordLink(me.id, newManager, "setup")), at: Date.now() } : { ok, at: Date.now() };
  } catch (e) {
    return { error: await errorMessage(e), at: Date.now() };
  }
}

/** "Add a new manager" on an existing department. */
export async function addDepartmentManager(_: LinkResult, form: FormData): Promise<LinkResult> {
  try {
    const me = await assertRole(ADMINS);
    const departmentId = z.uuid().parse(form.get("departmentId"));
    const userId = await withActor(me.id, (tx) => addNewManager(tx, departmentId, form));
    if (!userId) throw new AppError("nameTooShort");
    revalidatePath("/admin/departments");
    return { ok: (await getTranslations("departments"))("managerAdded"), ...(await sendPasswordLink(me.id, userId, "setup")), at: Date.now() };
  } catch (e) {
    return { error: await errorMessage(e), at: Date.now() };
  }
}
