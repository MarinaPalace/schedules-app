"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { employeeRates, employees, jobRoles, locations, user } from "@/db/schema";
import { withActor, type Tx } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import type { ImportRow } from "@/lib/import-rows";
import { parseEurToCents, parsePayPerHour } from "@/lib/money";
import { assignableRoles, canEditStaffOf, getCurrentUser, PEOPLE_ADMINS, ROLES, type CurrentUser, type Role } from "@/lib/session";
import { createLogin, randomPassword } from "@/lib/users";
import { sendPasswordLink } from "@/lib/account-links";
import type { LinkResult } from "@/lib/link-result";
import { errorMessage } from "@/lib/errors";
import { notifyRateChanged } from "@/lib/notify/events";

// Admin, owner and GM manage everyone; a department manager manages the staff of their own departments
// (access level "Employee" only, no moves to other departments).

const employeeFields = z.object({
  firstName: z.string().trim().min(1, "nameTooShort"),
  lastName: z.string().trim().min(1, "nameTooShort"),
  employeeNo: z.string().trim().optional().transform((v) => v || null),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  departmentId: z.uuid("chooseDepartment"),
});
const optionalId = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.uuid().nullable());
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

async function me() {
  const u = await getCurrentUser();
  if (!u) throw new AppError("notSignedIn");
  return u;
}

/** The employee, if this user may edit them. */
async function editable(editor: CurrentUser, employeeId: string) {
  const emp = await db.query.employees.findFirst({ where: eq(employees.id, z.uuid().parse(employeeId)) });
  if (!emp) throw new AppError("employeeNotFound");
  if (!(await canEditStaffOf(editor, emp.departmentId))) throw new AppError("notAllowed");
  // Managers edit their staff – not themselves or other managers (e.g. their own pay).
  if (editor.role === "manager" && emp.userId) {
    const login = await db.query.user.findFirst({ where: eq(user.id, emp.userId), columns: { role: true } });
    if (emp.userId === editor.id || (login && !assignableRoles(editor).includes(login.role as Role))) throw new AppError("notAllowed");
  }
  return emp;
}

/** Pay per hour; the form may also send a monthly amount + hours ("1000 € for 160 h"). */
function rateFrom(form: FormData): number {
  const cents = parseEurToCents(String(form.get("hourlyRate") ?? ""));
  if (cents === null || cents <= 0) throw new AppError("rateFormat");
  return cents;
}

/** The access level requested in the form, checked against what this user may hand out. */
function accessFrom(form: FormData, user: CurrentUser): Role {
  const role = z.enum(ROLES).catch("employee").parse(form.get("role") ?? "employee");
  if (!assignableRoles(user).includes(role)) throw new AppError("notAllowed");
  return role;
}

/** Position = a role of the employee's department; its name is kept as the shown position. */
async function positionFrom(tx: Tx, form: FormData, departmentId: string) {
  const jobRoleId = optionalId.parse(form.get("jobRoleId") ?? "");
  const homeLocationId = optionalId.parse(form.get("homeLocationId") ?? "");
  let position: string | null = null;
  if (jobRoleId) {
    const r = await tx.query.jobRoles.findFirst({ where: eq(jobRoles.id, jobRoleId) });
    if (r?.departmentId !== departmentId) throw new AppError("otherDepartment");
    position = r.name;
  }
  if (homeLocationId) {
    const l = await tx.query.locations.findFirst({ where: eq(locations.id, homeLocationId) });
    if (l?.departmentId !== departmentId) throw new AppError("otherDepartment");
  }
  return { jobRoleId, homeLocationId, position };
}

function changed(employeeId?: string) {
  if (employeeId) revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/admin/employees");
  revalidatePath("/setup");
  revalidatePath("/team");
}

export async function createEmployee(_: LinkResult, form: FormData): Promise<LinkResult> {
  return linkAction(async () => {
    const u = await me();
    const data = employeeFields.parse(Object.fromEntries(form));
    if (!(await canEditStaffOf(u, data.departmentId))) throw new AppError("notAllowed");
    const hourlyRateCents = rateFrom(form);
    const effectiveFrom = dateSchema.parse(form.get("effectiveFrom"));
    const username = String(form.get("username") ?? "").trim();
    const contactEmail = emailSchema.parse(form.get("email") ?? "");
    const role = accessFrom(form, u);
    const name = `${data.firstName} ${data.lastName}`;

    const userId = await withActor(u.id, async (tx) => {
      const pos = await positionFrom(tx, form, data.departmentId);
      const userId = username ? await createLogin(tx, { username, password: randomPassword(), name, role, contactEmail }) : null;
      const [emp] = await tx
        .insert(employees)
        .values({ ...data, ...pos, userId })
        .returning();
      await tx.insert(employeeRates).values({ employeeId: emp.id, hourlyRateCents, effectiveFrom, createdBy: u.id });
      return userId;
    });
    changed();
    const t = await getTranslations("employees");
    if (!userId) return { ok: t("added", { name }) };
    return { ok: t("addedWithLogin", { name, username: username.toLowerCase() }), ...(await sendPasswordLink(u.id, userId, "setup")) };
  });
}

export async function updateEmployee(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const u = await me();
    const emp = await editable(u, String(form.get("id")));
    const data = employeeFields.parse(Object.fromEntries(form));
    // Moving someone to another department is for admin/owner/GM.
    if (data.departmentId !== emp.departmentId && !PEOPLE_ADMINS.includes(u.role)) throw new AppError("moveByGm");
    const active = form.get("active") === "on";
    const login = emp.userId ? await db.query.user.findFirst({ where: eq(user.id, emp.userId) }) : null;
    // Access is only changed when the form sends one and the editor may manage that person's current access.
    const wantedRole = login && form.get("role") ? accessFrom(form, u) : null;
    if (login && wantedRole && wantedRole !== login.role && !assignableRoles(u).includes(login.role as Role)) throw new AppError("notAllowed");
    if (login && !assignableRoles(u).includes(login.role as Role) && !active) throw new AppError("notAllowed");

    await withActor(u.id, async (tx) => {
      // A move to another department clears position and usual place (they belong to the old department).
      const moved = data.departmentId !== emp.departmentId;
      const pos = moved ? { jobRoleId: null, homeLocationId: null, position: null } : await positionFrom(tx, form, data.departmentId);
      await tx
        .update(employees)
        .set({ ...data, ...pos, position: pos.position ?? (moved ? null : emp.position), active })
        .where(eq(employees.id, emp.id));
      // A deactivated employee can no longer log in.
      if (login) {
        await tx
          .update(user)
          .set({ active, name: `${data.firstName} ${data.lastName}`, role: wantedRole ?? login.role, updatedAt: new Date() })
          .where(eq(user.id, login.id));
      }
    });
    changed(emp.id);
  });
}

export async function addRate(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const u = await me();
    const emp = await editable(u, String(form.get("employeeId")));
    const hourlyRateCents = rateFrom(form);
    const effectiveFrom = dateSchema.parse(form.get("effectiveFrom"));
    await withActor(u.id, (tx) => tx.insert(employeeRates).values({ employeeId: emp.id, hourlyRateCents, effectiveFrom, createdBy: u.id }));
    // Managers may set pay; the GM hears about every change they make.
    if (u.role === "manager") notifyRateChanged(emp.id, hourlyRateCents, effectiveFrom, u.id);
    changed(emp.id);
    return (await getTranslations("employees"))("rateAdded");
  });
}

export async function createEmployeeLogin(_: LinkResult, form: FormData): Promise<LinkResult> {
  return linkAction(async () => {
    const u = await me();
    const emp = await editable(u, String(form.get("employeeId")));
    const role = accessFrom(form, u);
    const contactEmail = emailSchema.parse(form.get("email") ?? "");
    const userId = await withActor(u.id, async (tx) => {
      const fresh = await tx.query.employees.findFirst({ where: eq(employees.id, emp.id) });
      if (fresh?.userId) throw new AppError("employeeHasLogin");
      const userId = await createLogin(tx, {
        username: String(form.get("username") ?? ""),
        password: randomPassword(),
        name: `${emp.firstName} ${emp.lastName}`,
        role,
        contactEmail,
      });
      await tx.update(employees).set({ userId }).where(eq(employees.id, emp.id));
      return userId;
    });
    // No revalidate: the page would swap to "has a login" and hide the link/QR; the Done button reloads it.
    return { ok: (await getTranslations("employees"))("loginCreated"), ...(await sendPasswordLink(u.id, userId, "setup")) };
  });
}

/** Connects an existing login (e.g. a manager created under Users) to this employee record. */
export async function linkExistingLogin(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const u = await me();
    const emp = await editable(u, String(form.get("employeeId")));
    const userId = z.string().min(1, "userNotFound").parse(form.get("userId"));
    const [target, taken] = await Promise.all([
      db.query.user.findFirst({ where: eq(user.id, userId) }),
      db.query.employees.findFirst({ where: eq(employees.userId, userId) }),
    ]);
    if (emp.userId) throw new AppError("employeeHasLogin");
    if (!target || taken) throw new AppError("userNotFound");
    if (!assignableRoles(u).includes(target.role as Role)) throw new AppError("notAllowed");
    await withActor(u.id, (tx) => tx.update(employees).set({ userId }).where(eq(employees.id, emp.id)));
    changed(emp.id);
    return (await getTranslations("employees"))("loginLinked");
  });
}

/**
 * A login this user may manage: its access level must be one they could hand out, and a manager
 * only reaches logins of employees in their own departments.
 */
async function manageableLogin(u: CurrentUser, userId: string) {
  const target = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!target) throw new AppError("userNotFound");
  if (!assignableRoles(u).includes(target.role as Role)) throw new AppError("adminOnlyReset");
  if (!PEOPLE_ADMINS.includes(u.role)) {
    const emp = await db.query.employees.findFirst({ where: eq(employees.userId, target.id) });
    if (!emp || !(await canEditStaffOf(u, emp.departmentId))) throw new AppError("notAllowed");
  }
  return target;
}

/** Sends the person a link to choose a new password (and shows it, to hand over in person). */
export async function resetPassword(_: LinkResult, form: FormData): Promise<LinkResult> {
  return linkAction(async () => {
    const u = await me();
    const target = await manageableLogin(u, z.string().min(1).parse(form.get("userId")));
    if (!target.active) throw new AppError("userInactive");
    const res = await sendPasswordLink(u.id, target.id, "reset");
    revalidatePath("/admin/users");
    return { ok: (await getTranslations("employees"))("resetLinkReady", { username: target.username ?? "" }), ...res };
  });
}

/** Email address used for notifications and password links. */
export async function updateLoginContact(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const u = await me();
    const target = await manageableLogin(u, z.string().min(1).parse(form.get("userId")));
    const contactEmail = emailSchema.parse(form.get("email") ?? "");
    await withActor(u.id, (tx) => tx.update(user).set({ contactEmail, updatedAt: new Date() }).where(eq(user.id, target.id)));
    revalidatePath("/admin/employees");
    revalidatePath("/admin/users");
  });
}

/** A fresh invite for someone who hasn't chosen a password yet (by email/Telegram if they have it). */
export async function resendInvite(userId: string): Promise<{ error?: string; ok?: string }> {
  try {
    const u = await me();
    const target = await manageableLogin(u, z.string().min(1).parse(userId));
    if (!target.active) throw new AppError("userInactive");
    const res = await sendPasswordLink(u.id, target.id, "setup", { telegramLink: false });
    revalidatePath("/admin/employees");
    const t = await getTranslations("links");
    return { ok: res.email === "sent" || res.telegram === "sent" ? t("resent") : t("resentNoChannel") };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}

/** Resends invites to everyone in a department who has a login but has never signed in. */
export async function resendAllInvites(departmentId: string): Promise<{ error?: string; ok?: string }> {
  try {
    const u = await me();
    if (!(await canEditStaffOf(u, z.uuid().parse(departmentId)))) throw new AppError("notAllowed");
    const { loginStatuses } = await import("@/lib/login-status");
    const staff = await db.query.employees.findMany({ where: eq(employees.departmentId, departmentId) });
    const ids = staff.filter((e) => e.active && e.userId).map((e) => e.userId!);
    const status = await loginStatuses(ids);
    let sent = 0;
    for (const id of ids) {
      if (status.get(id) === "active") continue;
      const target = await db.query.user.findFirst({ where: eq(user.id, id) });
      if (!target?.active || !assignableRoles(u).includes(target.role as Role)) continue;
      const res = await sendPasswordLink(u.id, id, "setup", { telegramLink: false });
      if (res.email === "sent" || res.telegram === "sent") sent++;
    }
    revalidatePath("/admin/employees");
    return { ok: (await getTranslations("links"))("resentAll", { count: sent }) };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}

export type ImportResult = { error?: string; ok?: string; rowErrors?: { row: number; error: string }[]; created?: { name: string; username: string | null; sent: boolean }[] };


/**
 * Bulk add (pasted from Excel). All rows are checked first – nothing is created if any row is wrong.
 * Positions are matched to the department's roles by name (missing ones are created when asked);
 * places by code or name. With logins, everyone gets an invite (email when given; else via slips/QR).
 */
export async function importStaff(departmentId: string, rows: ImportRow[], opts: { logins: boolean; createRoles: boolean }): Promise<ImportResult> {
  try {
    const u = await me();
    if (!(await canEditStaffOf(u, z.uuid().parse(departmentId)))) throw new AppError("notAllowed");
    if (!rows.length || rows.length > 500) throw new AppError("invalid");
    const t = await getTranslations("import");
    const { suggestUsername, uniqueUsername } = await import("@/lib/translit");
    const [roles, places, logins] = await Promise.all([
      db.select().from(jobRoles).where(eq(jobRoles.departmentId, departmentId)),
      db.select().from(locations).where(eq(locations.departmentId, departmentId)),
      db.select({ username: user.username }).from(user),
    ]);
    const taken = new Set(logins.map((l) => l.username ?? ""));
    const rowErrors: { row: number; error: string }[] = [];
    const plan = rows.map((r, i) => {
      const err = (key: Parameters<typeof t>[0]) => rowErrors.push({ row: i + 1, error: t(key) });
      const firstName = r.firstName?.trim() ?? "";
      const lastName = r.lastName?.trim() ?? "";
      if (!firstName || !lastName) err("errName");
      const cents = r.pay?.trim() ? parsePayPerHour(r.pay) : null;
      if (r.pay?.trim() && cents === null) err("errPay");
      const email = r.email?.trim() || null;
      if (email && !z.email().safeParse(email).success) err("errEmail");
      const pos = r.position?.trim() || null;
      const role = pos ? roles.find((x) => x.name.toLowerCase() === pos.toLowerCase()) : undefined;
      if (pos && !role && !opts.createRoles) err("errRole");
      const pl = r.place?.trim() || null;
      const place = pl ? places.find((x) => x.code.toLowerCase() === pl.toLowerCase() || x.name.toLowerCase() === pl.toLowerCase()) : undefined;
      if (pl && !place) err("errPlace");
      let username: string | null = null;
      if (opts.logins && firstName && lastName) {
        username = uniqueUsername(suggestUsername(firstName, lastName) || `user${i + 1}`, taken);
        taken.add(username);
      }
      return { firstName, lastName, phone: r.phone?.trim() || null, email, pos, role, place, cents, username };
    });
    if (rowErrors.length) return { rowErrors };

    const today = (await import("@/lib/dates")).todayISO();
    const created = await withActor(u.id, async (tx) => {
      const out: { name: string; username: string | null; userId: string | null }[] = [];
      const newRoles = new Map<string, string>();
      let sort = Math.max(0, ...roles.map((r) => r.sort));
      for (const p of plan) {
        let roleId = p.role?.id ?? null;
        let roleName = p.role?.name ?? null;
        if (p.pos && !roleId) {
          const k = p.pos.toLowerCase();
          if (!newRoles.has(k)) {
            const [r] = await tx.insert(jobRoles).values({ departmentId, name: p.pos, sort: ++sort }).returning();
            newRoles.set(k, r.id);
          }
          roleId = newRoles.get(k)!;
          roleName = p.pos;
        }
        const name = `${p.firstName} ${p.lastName}`;
        const userId = p.username ? await createLogin(tx, { username: p.username, password: randomPassword(), name, role: "employee", contactEmail: p.email }) : null;
        const [emp] = await tx
          .insert(employees)
          .values({ firstName: p.firstName, lastName: p.lastName, phone: p.phone, departmentId, jobRoleId: roleId, position: roleName, homeLocationId: p.place?.id ?? null, userId })
          .returning();
        if (p.cents) await tx.insert(employeeRates).values({ employeeId: emp.id, hourlyRateCents: p.cents, effectiveFrom: today, createdBy: u.id });
        out.push({ name, username: p.username, userId });
      }
      return out;
    });
    // Invites after saving: by email where there is one; the rest get their link on the printed slips.
    const result: { name: string; username: string | null; sent: boolean }[] = [];
    for (const c of created) {
      let sent = false;
      if (c.userId) {
        const r = await sendPasswordLink(u.id, c.userId, "setup", { telegramLink: false });
        sent = r.email === "sent" || r.telegram === "sent";
      }
      result.push({ name: c.name, username: c.username, sent });
    }
    changed();
    return { ok: t("done", { count: created.length }), created: result };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}
