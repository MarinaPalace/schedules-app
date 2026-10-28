import Link from "next/link";
import { notFound } from "next/navigation";
import { addMonths, isMonth, monthLabel, monthOf } from "@/lib/calendar";
import { budgetStatus, computeMonth } from "@/lib/costs";
import { todayISO } from "@/lib/dates";
import { formatEur } from "@/lib/money";
import { getVisibleDepartments, requireUser } from "@/lib/session";
import { formatHours } from "@/lib/shifts";
import { CostChart } from "@/components/cost-chart";
import { cumulativeCost } from "@/lib/chart-data";
import { PeriodNav, href } from "@/components/toolbar";
import { getLocale, getTranslations } from "next-intl/server";

export default async function DepartmentDashboard({ params, searchParams }: PageProps<"/dashboard/[deptId]">) {
  const user = await requireUser(["manager", "top_manager", "owner", "accountant", "admin"]);
  const { deptId } = await params;
  const sp = (await searchParams) as { month?: string };
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const dept = (await getVisibleDepartments(user)).find((d) => d.id === deptId);
  if (!dept) notFound();
  const today = todayISO();
  const month = isMonth(sp.month) ? sp.month : monthOf(today);
  const m = (await computeMonth([dept.id], month)).get(dept.id)!;
  const status = budgetStatus(m);

  const data = cumulativeCost([m], today);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href={href("/dashboard", { month })} className="text-sm text-blue-700 hover:underline">{t("dashboard.allDepartmentsBack")}</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="page-title mr-2">{dept.name}</h1>
          <PeriodNav
            label={monthLabel(month, locale)}
            prev={href(`/dashboard/${dept.id}`, { month: addMonths(month, -1) })}
            next={href(`/dashboard/${dept.id}`, { month: addMonths(month, 1) })}
          />
          <Link href={href("/schedule", { dept: dept.id, view: "month", month })} className="btn btn-sm">{t("nav.schedule")}</Link>
          <Link href={href("/timesheet/month", { dept: dept.id, month })} className="btn btn-sm">{t("nav.forma76")}</Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card">
          <div className="text-xs text-gray-500">{t("common.budget")}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{m.budgetCents !== null ? formatEur(m.budgetCents) : "—"}</div>
          {m.budgetHours !== null && <div className="text-xs text-gray-500">{t("dashboard.plannedHours", { hours: m.budgetHours })}</div>}
        </div>
        <div className="card">
          <div className="text-xs text-gray-500">{t("dashboard.actualProjected")}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {formatEur(m.actualCents)} <span className="text-gray-400">/</span> {formatEur(m.projectedCents)}
          </div>
          <div className="text-xs text-gray-500">
            {formatHours(m.actualMinutes)} / {formatHours(m.projectedMinutes)} {t("common.hourUnit")}
            {m.budgetHours !== null && ` ${t("dashboard.ofHours", { hours: m.budgetHours })}`}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500">{t("common.status")}</div>
          <div className={`mt-1 text-xl font-semibold ${status === "over" ? "text-red-700" : status === "none" ? "text-gray-500" : "text-green-700"}`}>
            {status === "over" ? `▲ ${t("dashboard.over")}` : status === "on_track" ? `● ${t("dashboard.onTrack")}` : status === "under" ? `✓ ${t("dashboard.under")}` : `○ ${t("dashboard.noBudget")}`}
          </div>
          {m.unapprovedDays > 0 && <div className="text-xs text-amber-700">{t("dashboard.unapprovedPast", { count: m.unapprovedDays })}</div>}
        </div>
      </div>

      <div className="card">
        <CostChart data={data} todayDay={month === monthOf(today) ? today.slice(8) : null} />
      </div>

      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="table">
          <thead>
            <tr>
              <th>{t("common.employee")}</th>
              <th className="text-right">{t("dashboard.approvedH")}</th>
              <th className="text-right">{t("dashboard.stillPlannedH")}</th>
              <th className="text-right">{t("dashboard.actualCost")}</th>
              <th className="text-right">{t("dashboard.projectedCost")}</th>
            </tr>
          </thead>
          <tbody>
            {m.employees.map((e) => (
              <tr key={e.employeeId}>
                <td className="font-medium">{e.name}</td>
                <td className="text-right tabular-nums">{formatHours(e.approvedMinutes)}</td>
                <td className="text-right text-gray-500 tabular-nums">{e.plannedMinutes ? formatHours(e.plannedMinutes) : "–"}</td>
                <td className="text-right tabular-nums">{formatEur(e.actualCents)}</td>
                <td className="text-right tabular-nums">{formatEur(e.projectedCents)}</td>
              </tr>
            ))}
            {m.employees.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-500">{t("dashboard.noHours")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
