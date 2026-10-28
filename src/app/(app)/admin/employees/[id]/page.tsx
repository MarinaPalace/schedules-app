import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db/client";
import { departments, employeeRates, employees, user } from "@/db/schema";
import { assignableRoles, PEOPLE_ADMINS, requireUser, type Role } from "@/lib/session";
import { formatEur } from "@/lib/money";
import { formatDate, formatDateTime, todayISO } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { RoleSelect } from "@/components/role-select";
import { addRate, createEmployeeLogin, linkExistingLogin, resetPassword, updateEmployee } from "../actions";

export default async function EmployeePage({ params }: PageProps<"/admin/employees/[id]">) {
  const me = await requireUser(PEOPLE_ADMINS);
  const t = await getTranslations();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const emp = await db.query.employees.findFirst({ where: eq(employees.id, id) });
  if (!emp) notFound();

  const roles = assignableRoles(me);
  const [deps, rates, login, freeLogins] = await Promise.all([
    db.select().from(departments).orderBy(asc(departments.name)),
    db
      .select()
      .from(employeeRates)
      .where(eq(employeeRates.employeeId, id))
      .orderBy(desc(employeeRates.effectiveFrom), desc(employeeRates.createdAt)),
    emp.userId ? db.query.user.findFirst({ where: eq(user.id, emp.userId) }) : null,
    // Logins that are not an employee yet (e.g. managers created under "Users & roles").
    emp.userId
      ? []
      : db
          .select({ id: user.id, name: user.name, username: user.username, role: user.role })
          .from(user)
          .leftJoin(employees, eq(employees.userId, user.id))
          .where(isNull(employees.id))
          .orderBy(asc(user.name)),
  ]);
  const canManageLogin = !login || roles.includes(login.role as Role);
  const linkable = freeLogins.filter((u) => roles.includes(u.role as Role));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/admin/employees" className="text-sm text-blue-700 hover:underline">{t("employees.back")}</Link>
        <h1 className="page-title mt-1">
          {emp.firstName} {emp.lastName}
        </h1>
      </div>

      <section className="card">
        <h2 className="mb-3 font-medium">{t("employees.details")}</h2>
        <ActionForm action={updateEmployee} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={emp.id} />
          <div>
            <label className="label">{t("common.firstName")}</label>
            <input name="firstName" defaultValue={emp.firstName} className="input" required />
          </div>
          <div>
            <label className="label">{t("common.lastName")}</label>
            <input name="lastName" defaultValue={emp.lastName} className="input" required />
          </div>
          <div>
            <label className="label">{t("common.department")}</label>
            <select name="departmentId" defaultValue={emp.departmentId} className="input">
              {deps.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.active ? "" : ` (${t("common.inactive")})`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t("common.position")}</label>
            <input name="position" defaultValue={emp.position ?? ""} className="input" />
          </div>
          <div>
            <label className="label">{t("employees.phone")}</label>
            <input name="phone" type="tel" defaultValue={emp.phone ?? ""} className="input" />
          </div>
          <div>
            <label className="label">{t("common.employeeNo")}</label>
            <input name="employeeNo" defaultValue={emp.employeeNo ?? ""} className="input" />
          </div>
          {login && (
            <div>
              <label className="label">{t("common.role")}</label>
              {canManageLogin ? (
                <RoleSelect roles={roles} value={login.role} t={t} />
              ) : (
                <div className="input bg-gray-50">{t(`roles.${login.role as Role}`)}</div>
              )}
            </div>
          )}
          <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="canViewDepartment" defaultChecked={emp.canViewDepartment} /> {t("employees.canViewDepartment")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="active" defaultChecked={emp.active} /> {t("employees.activeBlocksLogin")}
            </label>
          </div>
          <div className="sm:col-span-2">
            <SubmitButton>{t("common.save")}</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">{t("employees.rateHistory")}</h2>
        <p className="mb-3 text-sm text-gray-500">{t("employees.rateHistoryHelp")}</p>
        <table className="table mb-4">
          <thead>
            <tr>
              <th>{t("employees.from")}</th>
              <th className="text-right">{t("employees.ratePerHour")}</th>
              <th>{t("employees.entered")}</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td>{formatDate(r.effectiveFrom)}</td>
                <td className="text-right tabular-nums">{formatEur(r.hourlyRateCents)}</td>
                <td className="text-gray-500">{formatDateTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ActionForm action={addRate} resetOnSuccess className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="employeeId" value={emp.id} />
          <div>
            <label className="label">{t("employees.newRate")}</label>
            <input name="hourlyRate" className="input w-32" inputMode="decimal" required />
          </div>
          <div>
            <label className="label">{t("employees.from")}</label>
            <input name="effectiveFrom" type="date" className="input" defaultValue={todayISO()} required />
          </div>
          <SubmitButton className="btn">{t("employees.addRate")}</SubmitButton>
        </ActionForm>
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">{t("employees.appLogin")}</h2>
        {login ? (
          <div className="space-y-3">
            <p className="text-sm">
              {t("common.username")}: <span className="font-mono">{login.username}</span>
              {!login.active && <span className="badge ml-2">{t("employees.blocked")}</span>}
            </p>
            {canManageLogin && (
              <ActionForm action={resetPassword} resetOnSuccess className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="userId" value={login.id} />
                <div>
                  <label className="label">{t("common.newPassword")}</label>
                  <input name="password" className="input" autoComplete="new-password" required minLength={6} />
                </div>
                <SubmitButton className="btn">{t("common.resetPassword")}</SubmitButton>
              </ActionForm>
            )}
          </div>
        ) : (
          <>
            <ActionForm action={createEmployeeLogin} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <input type="hidden" name="employeeId" value={emp.id} />
              <div>
                <label className="label">{t("common.username")}</label>
                <input name="username" className="input" autoCapitalize="none" required />
              </div>
              <div>
                <label className="label">{t("common.password")}</label>
                <input name="password" className="input" autoComplete="new-password" required minLength={6} />
              </div>
              <div>
                <label className="label">{t("common.role")}</label>
                <RoleSelect roles={roles} t={t} />
              </div>
              <SubmitButton className="btn">{t("employees.createLogin")}</SubmitButton>
            </ActionForm>
            {linkable.length > 0 && (
              <ActionForm action={linkExistingLogin} className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-4">
                <input type="hidden" name="employeeId" value={emp.id} />
                <div className="min-w-56 flex-1">
                  <label className="label">{t("employees.linkExisting")}</label>
                  <select name="userId" className="input" required defaultValue="">
                    <option value="" disabled>{t("common.choose")}</option>
                    {linkable.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.username}) – {t(`roles.${u.role as Role}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <SubmitButton className="btn">{t("employees.linkLogin")}</SubmitButton>
              </ActionForm>
            )}
          </>
        )}
      </section>
    </div>
  );
}
