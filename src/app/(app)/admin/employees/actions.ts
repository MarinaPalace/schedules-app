"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { employeeRates, employees, user } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import { parseEurToCents } from "@/lib/money";
import { assertRole, assignableRoles, PEOPLE_ADMINS, ROLES, type CurrentUser, type Role } from "@/lib/session";
import { createLogin, randomPassword } from "@/lib/users";
import { sendPasswordLink } from "@/lib/account-links";
import type { LinkResult } from "@/lib/link-result";
import { errorMessage } from "@/lib/errors";

const employeeFields = z.object({
  firstName: z.string().trim().min(1, "nameTooShort"),
  lastName: z.string().trim().min(1, "nameTooShort"),
  employeeNo: z.string().trim().optional().transform((v) => v || null),
  position: z.string().trim().optional().transform((v) => v || null),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  departmentId: z.uuid("chooseDepartment"),
});
const dateSchema = z.iso.date("dateRequired");
const emailSchema = z
  .string()
  .trim()
  .transform((v) => v || null)
  .pipe(z.email("emailFormat").max(200).nullable());

/** Runs an action that ends with a login link; errors become a translated message. */
async function linkAction(fn: () => Promise<LinkResult>): Promise<LinkResult> {
  try {
    return { ...(await fn()), at: Date.now() };
  } catch (e) {
    return { error: await errorMessage(e), at: Date.now() };
  }
}

function rateFrom(form: FormData): number {
  const cents = parseEurToCents(String(form.get("hourlyRate") ?? ""));
  if (cents === null || cents <= 0) throw new AppError("rateFormat");
  return cents;
}

/** The role requested in the form, checked against what this user may hand out. */
function roleFrom(form: FormData, me: CurrentUser): Role {
  const role = z.enum(ROLES).catch("employee").parse(form.get("role") ?? "employee");
  if (!assignableRoles(me).includes(role)) throw new AppError("notAllowed");
  return role;
}

export async function createEmployee(_: LinkResult, form: FormData): Promise<LinkResult> {
  return linkAction(async () => {
    const me = await assertRole(PEOPLE_ADMINS);
    const data = employeeFields.parse(Object.fromEntries(form));
    const hourlyRateCents = rateFrom(form);
    const effectiveFrom = dateSchema.parse(form.get("effectiveFrom"));
    const username = String(form.get("username") ?? "").trim();
    const contactEmail = emailSchema.parse(form.get("email") ?? "");
    const role = roleFrom(form, me);
    const name = `${data.firstName} ${data.lastName}`;

    const userId = await withActor(me.id, async (tx) => {
      const userId = username ? await createLogin(tx, { username, password: randomPassword(), name, role, contactEmail }) : null;
      const [emp] = await tx.insert(employees).values({ ...data, userId }).returning();
      await tx.insert(employeeRates).values({ employeeId: emp.id, hourlyRateCents, effectiveFrom, createdBy: me.id });
      return userId;
    });
    revalidatePath("/admin/employees");
    const t = await getTranslations("employees");
    if (!userId) return { ok: t("added", { name }) };
    return { ok: t("addedWithLogin", { name, username: username.toLowerCase() }), ...(await sendPasswordLink(me.id, userId, "setup")) };
  });
}

export async function updateEmployee(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(PEOPLE_ADMINS);
    const id = z.uuid().parse(form.get("id"));
    const data = employeeFields.parse(Object.fromEntries(form));
    const active = form.get("active") === "on";
    const emp = await db.query.employees.findFirst({ where: eq(employees.id, id) });
    if (!emp) throw new AppError("employeeNotFound");
    const login = emp.userId ? await db.query.user.findFirst({ where: eq(user.id, emp.userId) }) : null;
    // Role is only changed when the form sends one and the editor may manage that person's current role.
    const wantedRole = login && form.get("role") ? roleFrom(form, me) : null;
    if (login && wantedRole && wantedRole !== login.role && !assignableRoles(me).includes(login.role as Role)) throw new AppError("notAllowed");

    await withActor(me.id, async (tx) => {
      await tx
        .update(employees)
        .set({ ...data, active })
        .where(eq(employees.id, id));
      // A deactivated employee can no longer log in.
      if (login) {
        await tx
          .update(user)
          .set({ active, name: `${data.firstName} ${data.lastName}`, role: wantedRole ?? login.role, updatedAt: new Date() })
          .where(eq(user.id, login.id));
      }
    });
    revalidatePath(`/admin/employees/${id}`);
    revalidatePath("/admin/employees");
  });
}

export async function addRate(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(PEOPLE_ADMINS);
    const employeeId = z.uuid().parse(form.get("employeeId"));
    const hourlyRateCents = rateFrom(form);
    const effectiveFrom = dateSchema.parse(form.get("effectiveFrom"));
    await withActor(me.id, (tx) => tx.insert(employeeRates).values({ employeeId, hourlyRateCents, effectiveFrom, createdBy: me.id }));
    revalidatePath(`/admin/employees/${employeeId}`);
    return (await getTranslations("employees"))("rateAdded");
  });
}

export async function createEmployeeLogin(_: LinkResult, form: FormData): Promise<LinkResult> {
  return linkAction(async () => {
    const me = await assertRole(PEOPLE_ADMINS);
    const employeeId = z.uuid().parse(form.get("employeeId"));
    const role = roleFrom(form, me);
    const contactEmail = emailSchema.parse(form.get("email") ?? "");
    const userId = await withActor(me.id, async (tx) => {
      const emp = await tx.query.employees.findFirst({ where: eq(employees.id, employeeId) });
      if (!emp) throw new AppError("employeeNotFound");
      if (emp.userId) throw new AppError("employeeHasLogin");
      const userId = await createLogin(tx, {
        username: String(form.get("username") ?? ""),
        password: randomPassword(),
        name: `${emp.firstName} ${emp.lastName}`,
        role,
        contactEmail,
      });
      await tx.update(employees).set({ userId }).where(eq(employees.id, employeeId));
      return userId;
    });
    // No revalidate: the page would swap to "has a login" and hide the link/QR; the Done button reloads it.
    return { ok: (await getTranslations("employees"))("loginCreated"), ...(await sendPasswordLink(me.id, userId, "setup")) };
  });
}

/** Connects an existing login (e.g. a manager created under Users) to this employee record. */
export async function linkExistingLogin(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(PEOPLE_ADMINS);
    const employeeId = z.uuid().parse(form.get("employeeId"));
    const userId = z.string().min(1, "userNotFound").parse(form.get("userId"));
    const [emp, target, taken] = await Promise.all([
      db.query.employees.findFirst({ where: eq(employees.id, employeeId) }),
      db.query.user.findFirst({ where: eq(user.id, userId) }),
      db.query.employees.findFirst({ where: eq(employees.userId, userId) }),
    ]);
    if (!emp) throw new AppError("employeeNotFound");
    if (emp.userId) throw new AppError("employeeHasLogin");
    if (!target || taken) throw new AppError("userNotFound");
    if (!assignableRoles(me).includes(target.role as Role)) throw new AppError("notAllowed");
    await withActor(me.id, (tx) => tx.update(employees).set({ userId }).where(eq(employees.id, employeeId)));
    revalidatePath(`/admin/employees/${employeeId}`);
    return (await getTranslations("employees"))("loginLinked");
  });
}

/** Only for people whose role this user could also hand out. */
async function manageableLogin(me: CurrentUser, userId: string) {
  const target = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!target) throw new AppError("userNotFound");
  if (!assignableRoles(me).includes(target.role as Role)) throw new AppError("adminOnlyReset");
  return target;
}

/** Sends the person a link to choose a new password (and shows it, to hand over in person). */
export async function resetPassword(_: LinkResult, form: FormData): Promise<LinkResult> {
  return linkAction(async () => {
    const me = await assertRole(PEOPLE_ADMINS);
    const target = await manageableLogin(me, z.string().min(1).parse(form.get("userId")));
    if (!target.active) throw new AppError("userInactive");
    const res = await sendPasswordLink(me.id, target.id, "reset");
    revalidatePath("/admin/users");
    return { ok: (await getTranslations("employees"))("resetLinkReady", { username: target.username ?? "" }), ...res };
  });
}

/** Email address used for notifications and password links. */
export async function updateLoginContact(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(PEOPLE_ADMINS);
    const target = await manageableLogin(me, z.string().min(1).parse(form.get("userId")));
    const contactEmail = emailSchema.parse(form.get("email") ?? "");
    await withActor(me.id, (tx) => tx.update(user).set({ contactEmail, updatedAt: new Date() }).where(eq(user.id, target.id)));
    revalidatePath("/admin/employees");
    revalidatePath("/admin/users");
  });
}
