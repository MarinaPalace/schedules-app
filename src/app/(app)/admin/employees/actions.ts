"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { employeeRates, employees, user } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { parseEurToCents } from "@/lib/money";
import { assertRole } from "@/lib/session";
import { createLogin, setPassword } from "@/lib/users";

const ADMINS = ["admin", "top_manager"] as const;

const employeeFields = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  employeeNo: z.string().trim().optional().transform((v) => v || null),
  position: z.string().trim().optional().transform((v) => v || null),
  departmentId: z.uuid("Choose a department"),
});

function rateFrom(form: FormData): number {
  const cents = parseEurToCents(String(form.get("hourlyRate") ?? ""));
  if (cents === null || cents <= 0) throw new Error("Hourly rate must be a positive amount, e.g. 7.50");
  return cents;
}

export async function createEmployee(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const data = employeeFields.parse(Object.fromEntries(form));
    const hourlyRateCents = rateFrom(form);
    const effectiveFrom = z.iso.date("Rate start date is required").parse(form.get("effectiveFrom"));
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");

    await withActor(me.id, async (tx) => {
      const userId = username
        ? await createLogin(tx, { username, password, name: `${data.firstName} ${data.lastName}`, role: "employee" })
        : null;
      const [emp] = await tx
        .insert(employees)
        .values({ ...data, userId, canViewDepartment: form.get("canViewDepartment") === "on" })
        .returning();
      await tx.insert(employeeRates).values({ employeeId: emp.id, hourlyRateCents, effectiveFrom, createdBy: me.id });
    });
    revalidatePath("/admin/employees");
    return `${data.firstName} ${data.lastName} added${username ? ` with login "${username.toLowerCase()}"` : ""}`;
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
    const effectiveFrom = z.iso.date("Start date is required").parse(form.get("effectiveFrom"));
    await withActor(me.id, (tx) => tx.insert(employeeRates).values({ employeeId, hourlyRateCents, effectiveFrom, createdBy: me.id }));
    revalidatePath(`/admin/employees/${employeeId}`);
    return "Rate added";
  });
}

export async function createEmployeeLogin(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const employeeId = z.uuid().parse(form.get("employeeId"));
    await withActor(me.id, async (tx) => {
      const emp = await tx.query.employees.findFirst({ where: eq(employees.id, employeeId) });
      if (!emp) throw new Error("Employee not found");
      if (emp.userId) throw new Error("Employee already has a login");
      const userId = await createLogin(tx, {
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? ""),
        name: `${emp.firstName} ${emp.lastName}`,
        role: "employee",
      });
      await tx.update(employees).set({ userId }).where(eq(employees.id, employeeId));
    });
    revalidatePath(`/admin/employees/${employeeId}`);
    return "Login created";
  });
}

export async function resetPassword(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(["admin", "top_manager"]);
    const userId = z.string().min(1).parse(form.get("userId"));
    const target = await withActor(me.id, async (tx) => {
      const u = await tx.query.user.findFirst({ where: eq(user.id, userId) });
      if (!u) throw new Error("User not found");
      // Only admins may reset passwords of manager-level users.
      if (u.role !== "employee" && me.role !== "admin") throw new Error("Only an admin can reset this password");
      await setPassword(tx, userId, String(form.get("password") ?? ""));
      return u;
    });
    revalidatePath("/admin/users");
    return `Password for "${target.username}" changed`;
  });
}
