"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { departmentManagers, departments, user } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { assertRole } from "@/lib/session";

const ADMINS = ["admin", "top_manager"] as const;
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
      const managers = await tx.select({ id: user.id }).from(user).where(eq(user.role, "manager"));
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
