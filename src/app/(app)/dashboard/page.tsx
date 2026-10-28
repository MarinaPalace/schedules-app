import Link from "next/link";
import { addMonths, isMonth, monthLabel, monthOf } from "@/lib/calendar";
import { budgetStatus, computeMonth, type BudgetStatus } from "@/lib/costs";
import { todayISO } from "@/lib/dates";
import { formatEur } from "@/lib/money";
import { getVisibleDepartments, requireUser } from "@/lib/session";
import { formatHours } from "@/lib/shifts";
import { CostChart } from "@/components/cost-chart";
import { cumulativeCost } from "@/lib/chart-data";
import { PeriodNav, href } from "@/components/toolbar";
import { getLocale, getTranslations } from "next-intl/server";

const STATUS: Record<BudgetStatus, { key: "noBudget" | "under" | "onTrack" | "over"; icon: string; cls: string }> = {
  none: { key: "noBudget", icon: "○", cls: "text-gray-500" },
  under: { key: "under", icon: "✓", cls: "text-green-700" },
  on_track: { key: "onTrack", icon: "●", cls: "text-amber-700" },
  over: { key: "over", icon: "▲", cls: "text-red-700" },
};

function Pct({ value, budget }: { value: number; budget: number | null }) {
  if (!budget) return null;
  return <span className="text-xs text-gray-500">{Math.round((value / budget) * 100)}%</span>;
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser(["manager", "top_manager", "owner", "accountant", "admin"]);
  const sp = (await searchParams) as { month?: string };
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const today = todayISO();
  const month = isMonth(sp.month) ? sp.month : monthOf(today);
  const deps = await getVisibleDepartments(user);
  if (!deps.length) return <p className="text-sm text-gray-500">{t("common.noDepartments")}</p>;

  const costs = await computeMonth(deps.map((d) => d.id), month);
  const months = deps.map((d) => costs.get(d.id)!);
  const total = months.reduce(
    (t, m) => ({
      budgetCents: m.budgetCents === null ? t.budgetCents : (t.budgetCents ?? 0) + m.budgetCents,
      actualCents: t.actualCents + m.actualCents,
      projectedCents: t.projectedCents + m.projectedCents,
      actualMinutes: t.actualMinutes + m.actualMinutes,
      projectedMinutes: t.projectedMinutes + m.projectedMinutes,
      unapprovedDays: t.unapprovedDays + m.unapprovedDays,
    }),
    { budgetCents: null as number | null, actualCents: 0, projectedCents: 0, actualMinutes: 0, projectedMinutes: 0, unapprovedDays: 0 },
  );
  const totalStatus = STATUS[budgetStatus(total)];
  const isCurrent = month === monthOf(today);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-2">{t("dashboard.title")}</h1>
        <PeriodNav
          label={monthLabel(month, locale)}
          prev={href("/dashboard", { month: addMonths(month, -1) })}
          next={href("/dashboard", { month: addMonths(month, 1) })}
          today={isCurrent ? undefined : "/dashboard"}
        />
        {["owner", "admin", "top_manager"].includes(user.role) && (
          <Link href={href("/admin/budgets", { month })} className="btn btn-sm">
            {t("dashboard.setBudgets")}
          </Link>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <div className="text-xs text-gray-500">{t("common.budget")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{total.budgetCents !== null ? formatEur(total.budgetCents) : "—"}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500">{t("dashboard.actualApproved")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatEur(total.actualCents)}</div>
          <div className="text-xs text-gray-500">{formatHours(total.actualMinutes)} h</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500">{t("dashboard.projectedEnd")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatEur(total.projectedCents)}</div>
          <div className="text-xs text-gray-500">{formatHours(total.projectedMinutes)} h</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500">{t("common.status")}</div>
          <div className={`mt-1 text-xl font-semibold ${totalStatus.cls}`}>
            {totalStatus.icon} {t(`dashboard.${totalStatus.key}`)}
          </div>
          {total.budgetCents !== null && (
            <div className="text-xs text-gray-500">
              {t(total.projectedCents > total.budgetCents ? "dashboard.overBy" : "dashboard.left", {
                amount: formatEur(Math.abs(total.budgetCents - total.projectedCents)),
              })}
            </div>
          )}
        </div>
      </div>

      {total.unapprovedDays > 0 && (
        <div className="card border-amber-200 bg-amber-50 py-3 text-sm text-amber-800">
          {t("dashboard.unapprovedWarning", { count: total.unapprovedDays })}
        </div>
      )}

      <div className="card">
        <h2 className="mb-2 text-sm font-medium">{t("dashboard.chartTitle", { name: deps.length === 1 ? deps[0].name : t("dashboard.allShown") })}</h2>
        <CostChart data={cumulativeCost(months, today)} todayDay={isCurrent ? today.slice(8) : null} />
      </div>

      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="table">
          <thead>
            <tr>
              <th>{t("common.department")}</th>
              <th className="text-right">{t("common.budget")}</th>
              <th className="text-right">{t("common.actual")}</th>
              <th className="text-right">{t("common.projected")}</th>
              <th>{t("common.status")}</th>
              <th className="text-right">{t("dashboard.unapprovedDays")}</th>
            </tr>
          </thead>
          <tbody>
            {deps.map((d, i) => {
              const m = months[i];
              const st = STATUS[budgetStatus(m)];
              return (
                <tr key={d.id}>
                  <td>
                    <Link href={href(`/dashboard/${d.id}`, { month })} className="font-medium text-blue-700 hover:underline">
                      {d.name}
                    </Link>
                  </td>
                  <td className="text-right tabular-nums">{m.budgetCents !== null ? formatEur(m.budgetCents) : "—"}</td>
                  <td className="text-right tabular-nums">
                    {formatEur(m.actualCents)} <Pct value={m.actualCents} budget={m.budgetCents} />
                  </td>
                  <td className="text-right tabular-nums">
                    {formatEur(m.projectedCents)} <Pct value={m.projectedCents} budget={m.budgetCents} />
                  </td>
                  <td className={`whitespace-nowrap ${st.cls}`}>
                    {st.icon} {t(`dashboard.${st.key}`)}
                  </td>
                  <td className="text-right tabular-nums">
                    {m.unapprovedDays ? (
                      <Link className="text-amber-700 hover:underline" href={href("/timesheet/month", { dept: d.id, month })}>
                        {m.unapprovedDays}
                      </Link>
                    ) : (
                      "–"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold">
              <td className="px-3 py-2">{t("common.total")}</td>
              <td className="px-3 text-right tabular-nums">{total.budgetCents !== null ? formatEur(total.budgetCents) : "—"}</td>
              <td className="px-3 text-right tabular-nums">{formatEur(total.actualCents)}</td>
              <td className="px-3 text-right tabular-nums">{formatEur(total.projectedCents)}</td>
              <td className={`px-3 ${totalStatus.cls}`}>
                {totalStatus.icon} {t(`dashboard.${totalStatus.key}`)}
              </td>
              <td className="px-3 text-right tabular-nums">{total.unapprovedDays || "–"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        {t("dashboard.footnote")}
      </p>
    </div>
  );
}
