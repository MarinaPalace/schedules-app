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
import { createLogin, setPassword } from "@/lib/users";

const employeeFields = z.object({
  firstName: z.string().trim().min(1, "nameTooShort"),
  lastName: z.string().trim().min(1, "nameTooShort"),
  employeeNo: z.string().trim().optional().transform((v) => v || null),
  position: z.string().trim().optional().transform((v) => v || null),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  departmentId: z.uuid("chooseDepartment"),
});
const dateSchema = z.iso.date("dateRequired");

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

export async function createEmployee(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(PEOPLE_ADMINS);
    const data = employeeFields.parse(Object.fromEntries(form));
    const hourlyRateCents = rateFrom(form);
    const effectiveFrom = dateSchema.parse(form.get("effectiveFrom"));
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const role = roleFrom(form, me);
    const name = `${data.firstName} ${data.lastName}`;

    await withActor(me.id, async (tx) => {
      const userId = username ? await createLogin(tx, { username, password, name, role }) : null;
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
        .set({ ...data, active, canViewDepartment: form.get("canViewDepartment") === "on" })
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

export async function createEmployeeLogin(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(PEOPLE_ADMINS);
    const employeeId = z.uuid().parse(form.get("employeeId"));
    const role = roleFrom(form, me);
    await withActor(me.id, async (tx) => {
      const emp = await tx.query.employees.findFirst({ where: eq(employees.id, employeeId) });
      if (!emp) throw new AppError("employeeNotFound");
      if (emp.userId) throw new AppError("employeeHasLogin");
      const userId = await createLogin(tx, {
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? ""),
        name: `${emp.firstName} ${emp.lastName}`,
        role,
      });
      await tx.update(employees).set({ userId }).where(eq(employees.id, employeeId));
    });
    revalidatePath(`/admin/employees/${employeeId}`);
    return (await getTranslations("employees"))("loginCreated");
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

export async function resetPassword(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(PEOPLE_ADMINS);
    const userId = z.string().min(1).parse(form.get("userId"));
    const target = await db.query.user.findFirst({ where: eq(user.id, userId) });
    if (!target) throw new AppError("userNotFound");
    // Only for people whose role this user could also hand out.
    if (!assignableRoles(me).includes(target.role as Role)) throw new AppError("adminOnlyReset");
    await withActor(me.id, (tx) => setPassword(tx, userId, String(form.get("password") ?? "")));
    revalidatePath("/admin/users");
    return (await getTranslations("employees"))("passwordChanged", { username: target.username ?? "" });
  });
}
