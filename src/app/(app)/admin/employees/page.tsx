import Link from "next/link";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/db/client";
import { departments, employeeRates, employees, user } from "@/db/schema";
import { assignableRoles, requireUser, staffDepartments, STAFF_EDITORS, type Role } from "@/lib/session";
import { loginStatuses } from "@/lib/login-status";
import { loadLocations, loadRoles } from "@/lib/org";
import { formatEur } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { href } from "@/lib/href";
import { SubmitButton } from "@/components/action-form";
import { ActionButton } from "@/components/action-button";
import { EmployeeFields } from "@/components/employee-fields";
import { EmptyState } from "@/components/empty-state";
import { LinkForm } from "@/components/link-form";
import { PageHelp } from "@/components/page-help";
import { Disclosure } from "@/components/disclosure";
import { createEmployee, resendAllInvites, resendInvite } from "./actions";

export default async function EmployeesPage({ searchParams }: PageProps<"/admin/employees">) {
  const me = await requireUser(STAFF_EDITORS);
  const t = await getTranslations();
  const { dept, inactive } = (await searchParams) as { dept?: string; inactive?: string };
  const today = todayISO();
  const deps = await staffDepartments(me);
  const depIds = deps.map((d) => d.id);
  if (!deps.length) return <EmptyState icon="team" title={t("employees.title")} text={t("empty.noDepartmentsForStaff")} />;

  const filters: SQL[] = [inArray(employees.departmentId, depIds)];
  if (dept && depIds.includes(dept)) filters.push(eq(employees.departmentId, dept));
  if (!inactive) filters.push(eq(employees.active, true));

  const [rows, roles, places] = await Promise.all([
    db
      .select({
        id: employees.id,
        name: sql<string>`${employees.lastName} || ' ' || ${employees.firstName}`,
        position: employees.position,
        phone: employees.phone,
        active: employees.active,
        departmentId: employees.departmentId,
        department: departments.name,
        userId: user.id,
        username: user.username,
        role: user.role,
        rate: sql<number | null>`(select ${employeeRates.hourlyRateCents} from ${employeeRates}
          where ${employeeRates.employeeId} = ${employees.id} and ${employeeRates.effectiveFrom} <= ${today}
          order by ${employeeRates.effectiveFrom} desc, ${employeeRates.createdAt} desc limit 1)`,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(user, eq(user.id, employees.userId))
      .where(and(...filters))
      .orderBy(asc(departments.name), asc(employees.lastName)),
    loadRoles(depIds),
    loadLocations(depIds),
  ]);
  const status = await loginStatuses(rows.flatMap((r) => (r.userId ? [r.userId] : [])));
  const formDeps = deps.map((d) => ({
    id: d.id,
    name: d.name,
    roles: roles.filter((r) => r.departmentId === d.id).map(({ id, name }) => ({ id, name })),
    places: places.filter((l) => l.departmentId === d.id).map(({ id, name, code }) => ({ id, name, code })),
  }));
  const shownDept = dept && depIds.includes(dept) ? dept : deps.length === 1 ? deps[0].id : null;
  const notActive = rows.filter((r) => r.userId && status.get(r.userId) !== "active").length;
  const STATUS: Record<string, string> = { invited: "bg-amber-100 text-amber-800", active: "bg-green-100 text-green-800", expired: "bg-red-100 text-red-800" };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-auto">{t("employees.title")}</h1>
        <PageHelp text={t("help.employees")} />
        <Link href={href("/admin/employees/import", { dept: shownDept })} className="btn btn-sm">
          ⇪ {t("import.title")}
        </Link>
        {shownDept && (
          <a href={href("/admin/employees/slips", { dept: shownDept })} target="_blank" rel="noopener" className="btn btn-sm">
            🖨 {t("slips.title")}
          </a>
        )}
      </div>

      <Disclosure className="card" defaultOpen={rows.length === 0}>
        <summary className="cursor-pointer font-medium">{t("employees.addToggle")}</summary>
        <LinkForm action={createEmployee} resetOnSuccess className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <EmployeeFields departments={formDeps} defaultDept={shownDept ?? undefined} access={assignableRoles(me)} today={today} />
          <div className="sm:col-span-2 lg:col-span-3">
            <SubmitButton>{t("employees.add")}</SubmitButton>
            <p className="mt-1 text-xs text-gray-500">{t("employees.inviteHelp")}</p>
          </div>
        </LinkForm>
      </Disclosure>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <form className="flex flex-wrap items-center gap-3">
          {deps.length > 1 && (
            <select name="dept" defaultValue={dept ?? ""} className="input w-auto">
              <option value="">{t("common.allDepartments")}</option>
              {deps.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" name="inactive" value="1" defaultChecked={!!inactive} /> {t("employees.showInactive")}
          </label>
          <button className="btn">{t("common.filter")}</button>
        </form>
        {shownDept && notActive > 0 && (
          <ActionButton action={resendAllInvites} args={[shownDept]} className="btn btn-sm ml-auto" showOk confirm={t("links.resendAllConfirm", { count: notActive })}>
            ✉ {t("links.resendAll", { count: notActive })}
          </ActionButton>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="team" title={t("empty.staffTitle")} text={t("empty.staffText")} />
      ) : (
        <div className="card overflow-x-auto p-0 sm:p-0">
          <table className="table">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("common.department")}</th>
                <th>{t("common.position")}</th>
                <th>{t("employees.phone")}</th>
                <th className="text-right">{t("employees.ratePerHour")}</th>
                <th>{t("employees.login")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const st = e.userId ? status.get(e.userId) : undefined;
                // Managers don't edit themselves or other managers (e.g. their pay).
                const open = me.role !== "manager" || !e.userId || (e.userId !== me.id && assignableRoles(me).includes(e.role as Role));
                return (
                  <tr key={e.id} className={e.active ? "" : "text-gray-400"}>
                    <td>
                      {open ? (
                        <Link href={`/admin/employees/${e.id}`} className="font-medium text-blue-700 hover:underline">
                          {e.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{e.name}</span>
                      )}
                      {!e.active && <span className="badge ml-2">{t("common.inactive")}</span>}
                    </td>
                    <td>{e.department}</td>
                    <td>{e.position}</td>
                    <td className="whitespace-nowrap">{e.phone}</td>
                    <td className="text-right tabular-nums">{e.rate !== null ? formatEur(e.rate) : "—"}</td>
                    <td className="text-gray-500">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{e.username ?? "—"}</span>
                        {e.role && e.role !== "employee" && <span className="badge">{t(`roles.${e.role as Role}`)}</span>}
                        {st && <span className={`badge ${STATUS[st]}`}>{t(`links.status.${st}`)}</span>}
                        {st && st !== "active" && e.active && assignableRoles(me).includes(e.role as Role) && (
                          <ActionButton action={resendInvite} args={[e.userId!]} className="btn btn-sm" showOk>
                            {t("links.resend")}
                          </ActionButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
