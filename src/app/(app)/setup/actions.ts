"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull, isNotNull, max } from "drizzle-orm";
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
    await withActor(me.id, async (tx) => {
      const [{ last }] = await tx.select({ last: max(jobRoles.sort) }).from(jobRoles).where(eq(jobRoles.departmentId, departmentId));
      await tx.insert(jobRoles).values({ departmentId, name: name.parse(form.get("name")), sort: (last ?? 0) + 1 });
    });
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
        .set({ name: name.parse(form.get("name")), active: form.get("active") === "on" })
        .where(eq(jobRoles.id, id)),
    );
    done();
  });
}

export async function createLocation(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const departmentId = z.uuid().parse(form.get("departmentId"));
    const me = await authorize(departmentId);
    await withActor(me.id, async (tx) => {
      const [{ last }] = await tx.select({ last: max(locations.sort) }).from(locations).where(eq(locations.departmentId, departmentId));
      await tx.insert(locations).values({ departmentId, name: name.parse(form.get("name")), code: code.parse(form.get("code")), sort: (last ?? 0) + 1 });
    });
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
        .set({ name: name.parse(form.get("name")), code: code.parse(form.get("code")), active: form.get("active") === "on" })
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
      const roleName = jobRoleId ? (await tx.query.jobRoles.findFirst({ where: eq(jobRoles.id, jobRoleId) }))?.name : undefined;
      await tx.update(employees).set({ jobRoleId, homeLocationId, ...(roleName ? { position: roleName } : {}) }).where(eq(employees.id, id));
    });
    revalidatePath("/setup");
    revalidatePath("/schedule");
  });
}

type Result = { error?: string; ok?: string };
async function result(fn: () => Promise<void>): Promise<Result> {
  const r = await run(async () => {
    await fn();
  });
  return r.error ? { error: r.error } : { ok: "ok" };
}

/** ↑/↓: swaps a role or location with its neighbour in the list (the order shown everywhere). */
export async function moveItem(kind: "role" | "location", id: string, direction: -1 | 1): Promise<Result> {
  return result(async () => {
    z.enum(["role", "location"]).parse(kind);
    const table = kind === "role" ? jobRoles : locations;
    const item = await db.select().from(table).where(eq(table.id, z.uuid().parse(id))).then((r) => r[0]);
    if (!item) throw new AppError("invalid");
    const me = await authorize(item.departmentId);
    const list = await db.select({ id: table.id }).from(table).where(eq(table.departmentId, item.departmentId)).orderBy(asc(table.sort), asc(table.createdAt));
    const i = list.findIndex((x) => x.id === id);
    const j = i + direction;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    // Renumber the whole list, so older equal numbers can't confuse the order.
    await withActor(me.id, async (tx) => {
      for (const [n, x] of list.entries()) await tx.update(table).set({ sort: n + 1 }).where(eq(table.id, x.id));
    });
    done();
  });
}

/** Adds a ready-made role (from the presets) unless one with that name exists. */
export async function addPresetRole(departmentId: string, roleName: string): Promise<Result> {
  return result(async () => {
    const me = await authorize(z.uuid().parse(departmentId));
    const n = name.parse(roleName);
    await withActor(me.id, async (tx) => {
      const existing = await tx.select().from(jobRoles).where(eq(jobRoles.departmentId, departmentId));
      if (existing.some((r) => r.name.toLowerCase() === n.toLowerCase())) return;
      const last = Math.max(0, ...existing.map((r) => r.sort));
      await tx.insert(jobRoles).values({ departmentId, name: n, sort: last + 1 });
    });
    done();
  });
}

/**
 * Turns the old free-text positions of a department into roles: one role per different text
 * (re-using a role with the same name), and assigns it to those people.
 */
export async function rolesFromPositions(departmentId: string): Promise<Result> {
  return result(async () => {
    const me = await authorize(z.uuid().parse(departmentId));
    await withActor(me.id, async (tx) => {
      const people = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.departmentId, departmentId), isNull(employees.jobRoleId), isNotNull(employees.position)));
      const roles = await tx.select().from(jobRoles).where(eq(jobRoles.departmentId, departmentId));
      let last = Math.max(0, ...roles.map((r) => r.sort));
      for (const p of people) {
        const text = p.position!.trim();
        if (!text) continue;
        let role = roles.find((r) => r.name.toLowerCase() === text.toLowerCase());
        if (!role) {
          [role] = await tx.insert(jobRoles).values({ departmentId, name: text, sort: ++last }).returning();
          roles.push(role);
        }
        await tx.update(employees).set({ jobRoleId: role.id, position: role.name }).where(eq(employees.id, p.id));
      }
    });
    done();
  });
}
