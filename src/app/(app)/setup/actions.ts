"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { employees, jobRoles, locations } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import { canSetUpDepartment } from "@/lib/org";
import { getCurrentUser } from "@/lib/session";

async function authorize(departmentId: string) {
  const me = await getCurrentUser();
  if (!me || !(await canSetUpDepartment(me, departmentId))) throw new AppError("notAllowed");
  return me;
}

const name = z.string().trim().min(1, "nameTooShort").max(60);
const sort = z.coerce.number().int().min(0).max(999).catch(0);
const code = z
  .string()
  .trim()
  .min(1, "codeRequired")
  .max(6, "codeLength")
  .transform((v) => v.toUpperCase());

function done() {
  revalidatePath("/setup");
  revalidatePath("/schedule");
}

export async function createRole(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const departmentId = z.uuid().parse(form.get("departmentId"));
    const me = await authorize(departmentId);
    await withActor(me.id, (tx) => tx.insert(jobRoles).values({ departmentId, name: name.parse(form.get("name")), sort: sort.parse(form.get("sort")) }));
    done();
  });
}

export async function updateRole(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const id = z.uuid().parse(form.get("id"));
    const row = await db.query.jobRoles.findFirst({ where: eq(jobRoles.id, id) });
    if (!row) throw new AppError("invalid");
    const me = await authorize(row.departmentId);
    await withActor(me.id, (tx) =>
      tx
        .update(jobRoles)
        .set({ name: name.parse(form.get("name")), sort: sort.parse(form.get("sort")), active: form.get("active") === "on" })
        .where(eq(jobRoles.id, id)),
    );
    done();
  });
}

export async function createLocation(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const departmentId = z.uuid().parse(form.get("departmentId"));
    const me = await authorize(departmentId);
    await withActor(me.id, (tx) =>
      tx.insert(locations).values({ departmentId, name: name.parse(form.get("name")), code: code.parse(form.get("code")), sort: sort.parse(form.get("sort")) }),
    );
    done();
  });
}

export async function updateLocation(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const id = z.uuid().parse(form.get("id"));
    const row = await db.query.locations.findFirst({ where: eq(locations.id, id) });
    if (!row) throw new AppError("invalid");
    const me = await authorize(row.departmentId);
    await withActor(me.id, (tx) =>
      tx
        .update(locations)
        .set({ name: name.parse(form.get("name")), code: code.parse(form.get("code")), sort: sort.parse(form.get("sort")), active: form.get("active") === "on" })
        .where(eq(locations.id, id)),
    );
    done();
  });
}

const optionalId = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.uuid().nullable());

/** Usual role and place of a person – planning data, so the department's manager may set it. */
export async function setEmployeePlanning(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const id = z.uuid().parse(form.get("employeeId"));
    const emp = await db.query.employees.findFirst({ where: eq(employees.id, id) });
    if (!emp) throw new AppError("employeeNotFound");
    const me = await authorize(emp.departmentId);
    const jobRoleId = optionalId.parse(form.get("jobRoleId") ?? "");
    const homeLocationId = optionalId.parse(form.get("homeLocationId") ?? "");
    await withActor(me.id, async (tx) => {
      if (jobRoleId) {
        const r = await tx.query.jobRoles.findFirst({ where: eq(jobRoles.id, jobRoleId) });
        if (r?.departmentId !== emp.departmentId) throw new AppError("otherDepartment");
      }
      if (homeLocationId) {
        const l = await tx.query.locations.findFirst({ where: eq(locations.id, homeLocationId) });
        if (l?.departmentId !== emp.departmentId) throw new AppError("otherDepartment");
      }
      await tx.update(employees).set({ jobRoleId, homeLocationId }).where(eq(employees.id, id));
    });
    revalidatePath("/setup");
    revalidatePath("/schedule");
  });
}
