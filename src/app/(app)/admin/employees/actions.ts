"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { employeeRates, employees, user } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import { parseEurToCents } from "@/lib/money";
import { assertRole } from "@/lib/session";
import { createLogin, setPassword } from "@/lib/users";

const ADMINS = ["admin", "top_manager"] as const;

const employeeFields = z.object({
  firstName: z.string().trim().min(1, "nameTooShort"),
  lastName: z.string().trim().min(1, "nameTooShort"),
  employeeNo: z.string().trim().optional().transform((v) => v || null),
  position: z.string().trim().optional().transform((v) => v || null),
  departmentId: z.uuid("chooseDepartment"),
});
const dateSchema = z.iso.date("dateRequired");

function rateFrom(form: FormData): number {
  const cents = parseEurToCents(String(form.get("hourlyRate") ?? ""));
  if (cents === null || cents <= 0) throw new AppError("rateFormat");
  return cents;
}

export async function createEmployee(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const data = employeeFields.parse(Object.fromEntries(form));
    const hourlyRateCents = rateFrom(form);
    const effectiveFrom = dateSchema.parse(form.get("effectiveFrom"));
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = `${data.firstName} ${data.lastName}`;

    await withActor(me.id, async (tx) => {
      const userId = username ? await createLogin(tx, { username, password, name, role: "employee" }) : null;
      const [emp] = await tx
        .insert(employees)
        .values({ ...data, userId, canViewDepartment: form.get("canViewDepartment") === "on" })
        .returning();
      await tx.insert(employeeRates).values({ employeeId: emp.id, hourlyRateCents, effectiveFrom, createdBy: me.id });
    });
    revalidatePath("/admin/employees");
    const t = await getTranslations("employees");
    return username ? t("addedWithLogin", { name, username: username.toLowerCase() }) : t("added", { name });
  });
}

export async function updateEmployee(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const id = z.uuid().parse(form.get("id"));
    const data = employeeFields.parse(Object.fromEntries(form));
    const active = form.get("active") === "on";
    await withActor(me.id, async (tx) => {
      const [emp] = await tx
        .update(employees)
        .set({ ...data, active, canViewDepartment: form.get("canViewDepartment") === "on" })
        .where(eq(employees.id, id))
        .returning();
      // A deactivated employee can no longer log in.
      if (emp.userId) await tx.update(user).set({ active, updatedAt: new Date() }).where(eq(user.id, emp.userId));
    });
    revalidatePath(`/admin/employees/${id}`);
    revalidatePath("/admin/employees");
  });
}

export async function addRate(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const employeeId = z.uuid().parse(form.get("employeeId"));
    const hourlyRateCents = rateFrom(form);
    const effectiveFrom = dateSchema.parse(form.get("effectiveFrom"));
    await withActor(me.id, (tx) => tx.insert(employeeRates).values({ employeeId, hourlyRateCents, effectiveFrom, createdBy: me.id }));
    revalidatePath(`/admin/employees/${employeeId}`);
    return (await getTranslations("employees"))("rateAdded");
  });
}

export async function createEmployeeLogin(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const employeeId = z.uuid().parse(form.get("employeeId"));
    await withActor(me.id, async (tx) => {
      const emp = await tx.query.employees.findFirst({ where: eq(employees.id, employeeId) });
      if (!emp) throw new AppError("employeeNotFound");
      if (emp.userId) throw new AppError("employeeHasLogin");
      const userId = await createLogin(tx, {
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? ""),
        name: `${emp.firstName} ${emp.lastName}`,
        role: "employee",
      });
      await tx.update(employees).set({ userId }).where(eq(employees.id, employeeId));
    });
    revalidatePath(`/admin/employees/${employeeId}`);
    return (await getTranslations("employees"))("loginCreated");
  });
}

export async function resetPassword(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(["admin", "top_manager"]);
    const userId = z.string().min(1).parse(form.get("userId"));
    const target = await withActor(me.id, async (tx) => {
      const u = await tx.query.user.findFirst({ where: eq(user.id, userId) });
      if (!u) throw new AppError("userNotFound");
      // Only admins may reset passwords of manager-level users.
      if (u.role !== "employee" && me.role !== "admin") throw new AppError("adminOnlyReset");
      await setPassword(tx, userId, String(form.get("password") ?? ""));
      return u;
    });
    revalidatePath("/admin/users");
    return (await getTranslations("employees"))("passwordChanged", { username: target.username ?? "" });
  });
}
