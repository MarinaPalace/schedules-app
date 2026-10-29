import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { addMonths, isMonth, monthLabel, monthOf } from "@/lib/calendar";
import { todayISO } from "@/lib/dates";
import { buildRoleHours } from "@/lib/role-hours";
import { getVisibleDepartments, requireUser } from "@/lib/session";
import { formatHours } from "@/lib/shifts";
import { LinkTabs, PeriodNav, href } from "@/components/toolbar";

/** Hours per role per person – mainly for pay: hours outside the main role may have another rate. */
export default async function RoleHoursPage({ searchParams }: PageProps<"/timesheet/roles">) {
  const user = await requireUser(["manager", "top_manager", "owner", "accountant", "admin"]);
  const sp = (await searchParams) as { dept?: string; month?: string };
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const deps = await getVisibleDepartments(user);
  if (!deps.length) return <p className="text-sm text-gray-500">{t("common.noDepartments")}</p>;
  const dept = deps.find((d) => d.id === sp.dept) ?? deps[0];
  const month = isMonth(sp.month) ? sp.month : monthOf(todayISO());
  const { rows, columns, roles } = await buildRoleHours(dept.id, month);
  const roleName = (id: string | null) => (id ? (roles.find((r) => r.id === id)?.name ?? "?") : t("roleHours.noRole"));
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const cell = (approved?: number, planned?: number) => (
    <>
      {approved ? <span className="font-medium">{formatHours(approved)}</span> : ""}
      {planned ? <span className="ml-1 text-gray-400">({formatHours(planned)})</span> : ""}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-2">{t("roleHours.title")}</h1>
        <LinkTabs base="/timesheet/roles" params={{ month }} name="dept" value={dept.id} options={deps.map((d) => ({ value: d.id, label: d.name }))} />
        <PeriodNav
          label={monthLabel(month, locale)}
          prev={href("/timesheet/roles", { dept: dept.id, month: addMonths(month, -1) })}
          next={href("/timesheet/roles", { dept: dept.id, month: addMonths(month, 1) })}
        />
        <a href={href("/timesheet/roles/export", { dept: dept.id, month })} className="btn btn-primary btn-sm">
          {t("timesheet.download")}
        </a>
        <Link href={href("/timesheet/month", { dept: dept.id, month })} className="btn btn-sm">
          {t("timesheet.monthTitle")}
        </Link>
      </div>
      <p className="text-sm text-gray-500">{t("roleHours.help")}</p>

      {rows.length === 0 ? (
        <p className="card text-sm text-gray-500">{t("roleHours.empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0 sm:p-0">
          <table className="table">
            <thead>
              <tr>
                <th>{t("common.employee")}</th>
                <th>{t("roleHours.mainRole")}</th>
                {columns.map((c) => (
                  <th key={c.id} className="text-right">
                    {c.id ? c.name : t("roleHours.noRole")}
                  </th>
                ))}
                <th className="text-right">{t("roleHours.other")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="whitespace-nowrap">{r.name}</td>
                  <td className="whitespace-nowrap text-gray-600">{roleName(r.mainRoleId)}</td>
                  {columns.map((c) => (
                    <td key={c.id} className={`text-right tabular-nums ${c.id && c.id === r.mainRoleId ? "" : r.approved[c.id] || r.planned[c.id] ? "bg-amber-50" : ""}`}>
                      {cell(r.approved[c.id], r.planned[c.id])}
                    </td>
                  ))}
                  <td className={`text-right tabular-nums ${r.otherApproved || r.otherPlanned ? "font-semibold text-amber-800" : "text-gray-400"}`}>
                    {r.otherApproved || r.otherPlanned ? cell(r.otherApproved, r.otherPlanned) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td colSpan={2}>{t("common.total")}</td>
                {columns.map((c) => (
                  <td key={c.id} className="text-right tabular-nums">
                    {cell(sum((r) => r.approved[c.id] ?? 0), sum((r) => r.planned[c.id] ?? 0))}
                  </td>
                ))}
                <td className="text-right tabular-nums">{cell(sum((r) => r.otherApproved), sum((r) => r.otherPlanned))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">{t("roleHours.legend")}</p>
    </div>
  );
}
