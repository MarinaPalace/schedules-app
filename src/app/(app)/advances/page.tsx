import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { loadAdvances, type AdvanceRow } from "@/lib/advances";
import { addMonths, isMonth, monthBounds, monthLabel, monthOf } from "@/lib/calendar";
import { loadRates, loadTimesheet } from "@/lib/data";
import { formatDateTime, hotelDate, todayISO } from "@/lib/dates";
import { formatEur } from "@/lib/money";
import { rateAt } from "@/lib/rates";
import { getVisibleDepartments, MANAGES, requireUser } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ActionButton } from "@/components/action-button";
import { AdvanceBadge } from "@/components/advance-badge";
import { DecisionButtons } from "@/components/decision-buttons";
import { PeriodNav, href } from "@/components/toolbar";
import { decideAdvance, markAdvanceGiven, requestAdvanceFor } from "./actions";
import { getLocale, getTranslations } from "next-intl/server";

export default async function AdvancesPage({ searchParams }: PageProps<"/advances">) {
  const me = await requireUser(["manager", "top_manager", "admin", "owner", "accountant"]);
  const sp = (await searchParams) as { month?: string };
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const today = todayISO();
  const month = isMonth(sp.month) ? sp.month : monthOf(today);
  const deptIds = (await getVisibleDepartments(me)).map((d) => d.id);
  const canDecide = MANAGES.includes(me.role) || me.role === "accountant";
  const canGive = me.role === "accountant" || me.role === "admin";
  const canFileFor = MANAGES.includes(me.role);

  const [all, staff] = await Promise.all([
    loadAdvances({ departmentIds: deptIds }),
    canFileFor && deptIds.length
      ? db
          .select({ id: employees.id, first: employees.firstName, last: employees.lastName })
          .from(employees)
          .where(and(inArray(employees.departmentId, deptIds), eq(employees.active, true)))
          .orderBy(asc(employees.lastName))
      : Promise.resolve([]),
  ]);
  const pending = all.filter((a) => !a.decision).reverse();
  const toGive = all.filter((a) => a.decision === "approved" && !a.givenAt).reverse();
  const monthRows = all.filter((a) => monthOf(hotelDate(a.createdAt)) === month);
  const approvedTotal = monthRows.filter((a) => a.decision === "approved").reduce((s, a) => s + a.amountCents, 0);
  const givenTotal = monthRows.filter((a) => a.givenAt).reduce((s, a) => s + a.amountCents, 0);

  // Context for deciding: what the person has earned (approved Forma 76) and already got this month.
  const thisMonth = monthOf(today);
  const askers = [...new Set(pending.map((a) => a.employeeId))];
  const [timesheet, rates] = await Promise.all([loadTimesheet(askers, monthBounds(thisMonth).from, today), loadRates(askers)]);
  const earned = new Map<string, number>();
  for (const e of timesheet.values()) {
    earned.set(e.employeeId, (earned.get(e.employeeId) ?? 0) + Math.round((e.paidMinutes / 60) * rateAt(rates, e.employeeId, e.workDate)));
  }
  const advancedThisMonth = (employeeId: string) =>
    all
      .filter((a) => a.employeeId === employeeId && a.decision === "approved" && monthOf(hotelDate(a.createdAt)) === thisMonth)
      .reduce((s, a) => s + a.amountCents, 0);

  const who = (a: AdvanceRow) => `${a.employeeLast} ${a.employeeName}`;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="page-title">{t("advances.title")}</h1>
        <p className="text-sm text-gray-500">{t("advances.flow")}</p>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">{t("advances.waiting", { count: pending.length })}</h2>
        {pending.length === 0 && <p className="text-sm text-gray-500">{t("advances.nothing")}</p>}
        {pending.map((a) => (
          <div key={a.id} className="card grid gap-4 md:grid-cols-[1fr_16rem]">
            <div className="space-y-1 text-sm">
              <div className="font-medium">
                {who(a)} · <span className="tabular-nums">{formatEur(a.amountCents)}</span>
              </div>
              {a.note && <div className="text-gray-600">“{a.note}”</div>}
              <div className="text-gray-600">
                {t("advances.context", { earned: formatEur(earned.get(a.employeeId) ?? 0), advanced: formatEur(advancedThisMonth(a.employeeId)) })}
              </div>
              <div className="text-xs text-gray-400">{t("advances.requestedBy", { name: a.requestedBy ?? "", when: formatDateTime(a.createdAt) })}</div>
            </div>
            {canDecide && a.employeeUserId !== me.id ? (
              <DecisionButtons requestId={a.id} decide={decideAdvance} />
            ) : (
              <AdvanceBadge a={a} t={t} />
            )}
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">{t("advances.toGive", { count: toGive.length })}</h2>
        {toGive.length === 0 ? (
          <p className="text-sm text-gray-500">{t("advances.nothingToGive")}</p>
        ) : (
          <ul className="card divide-y divide-gray-100 p-0 sm:p-0">
            {toGive.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {who(a)} · <span className="tabular-nums">{formatEur(a.amountCents)}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {t("advances.approvedBy", { name: a.decidedBy ?? "", when: a.decidedAt ? formatDateTime(a.decidedAt) : "" })}
                    {a.note ? ` · “${a.note}”` : ""}
                  </div>
                </div>
                {canGive && a.employeeUserId !== me.id ? (
                  <ActionButton action={markAdvanceGiven} args={[a.id]} className="btn btn-primary">
                    ✓ {t("advances.markGiven")}
                  </ActionButton>
                ) : (
                  <span className="badge bg-blue-50 text-blue-700">{t("advances.waitingAccounting")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canFileFor && staff.length > 0 && (
        <section className="card">
          <h2 className="mb-3 font-medium">{t("advances.onBehalf")}</h2>
          <ActionForm action={requestAdvanceFor} resetOnSuccess className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label">{t("common.employee")}</label>
              <select name="employeeId" className="input" required defaultValue="">
                <option value="" disabled>{t("common.choose")}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last} {s.first}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t("common.amountEur")}</label>
              <input name="amount" className="input w-28" inputMode="decimal" required />
            </div>
            <div className="min-w-48 flex-1">
              <label className="label">{t("common.note")}</label>
              <input name="note" className="input" />
            </div>
            <SubmitButton>{t("advances.create")}</SubmitButton>
          </ActionForm>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">{t("advances.all")}</h2>
          <PeriodNav label={monthLabel(month, locale)} prev={href("/advances", { month: addMonths(month, -1) })} next={href("/advances", { month: addMonths(month, 1) })} />
          <span className="text-sm text-gray-600">
            {t("advances.approvedThisMonth")} <b className="tabular-nums">{formatEur(approvedTotal)}</b> · {t("advances.givenThisMonth")}{" "}
            <b className="tabular-nums">{formatEur(givenTotal)}</b>
          </span>
        </div>
        <div className="card overflow-x-auto p-0 sm:p-0">
          <table className="table">
            <thead>
              <tr>
                <th>{t("advances.requested")}</th>
                <th>{t("common.employee")}</th>
                <th className="text-right">{t("advances.amount")}</th>
                <th>{t("common.status")}</th>
                <th>{t("advances.decidedBy")}</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</td>
                  <td>{who(a)}</td>
                  <td className="text-right tabular-nums">{formatEur(a.amountCents)}</td>
                  <td>
                    <AdvanceBadge a={a} t={t} />
                  </td>
                  <td className="text-xs text-gray-500">
                    {a.decidedBy ?? ""}
                    {a.decisionNote ? ` – ${a.decisionNote}` : ""}
                    {a.givenAt && <div>{t("advances.givenBy", { name: a.givenBy ?? "", when: formatDateTime(a.givenAt) })}</div>}
                  </td>
                </tr>
              ))}
              {monthRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-gray-500">{t("advances.noneThisMonth")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
