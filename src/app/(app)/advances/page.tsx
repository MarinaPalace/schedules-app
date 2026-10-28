import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { loadAdvances } from "@/lib/advances";
import { addMonths, isMonth, monthLabel, monthOf } from "@/lib/calendar";
import { formatDateTime, todayISO } from "@/lib/dates";
import { formatEur } from "@/lib/money";
import { getVisibleDepartments, MANAGES, requireUser } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DecisionButtons } from "@/components/decision-buttons";
import { PeriodNav, href } from "@/components/toolbar";
import { decideAdvance, requestAdvanceFor } from "./actions";
import { getLocale, getTranslations } from "next-intl/server";

export default async function AdvancesPage({ searchParams }: PageProps<"/advances">) {
  const me = await requireUser(["manager", "top_manager", "admin", "owner", "accountant"]);
  const sp = (await searchParams) as { month?: string };
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const month = isMonth(sp.month) ? sp.month : monthOf(todayISO());
  const deptIds = (await getVisibleDepartments(me)).map((d) => d.id);
  const canDecide = MANAGES.includes(me.role);

  const [pending, monthRows, staff] = await Promise.all([
    loadAdvances({ departmentIds: deptIds }).then((r) => r.filter((a) => !a.decision)),
    loadAdvances({ departmentIds: deptIds, month }),
    canDecide && deptIds.length
      ? db
          .select({ id: employees.id, first: employees.firstName, last: employees.lastName })
          .from(employees)
          .where(and(inArray(employees.departmentId, deptIds), eq(employees.active, true)))
          .orderBy(asc(employees.lastName))
      : Promise.resolve([]),
  ]);
  const approvedTotal = monthRows.filter((a) => a.decision === "approved").reduce((s, a) => s + a.amountCents, 0);

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="page-title">{t("advances.title")}</h1>

      <section className="space-y-3">
        <h2 className="font-medium">{t("advances.waiting", { count: pending.length })}</h2>
        {pending.length === 0 && <p className="text-sm text-gray-500">{t("advances.nothing")}</p>}
        {pending.map((a) => (
          <div key={a.id} className="card grid gap-4 md:grid-cols-[1fr_16rem]">
            <div className="text-sm">
              <div className="font-medium">
                {a.employeeLast} {a.employeeName} · <span className="tabular-nums">{formatEur(a.amountCents)}</span>
              </div>
              {a.note && <div className="text-gray-600">“{a.note}”</div>}
              <div className="text-xs text-gray-400">
                {t("advances.requestedBy", { name: a.requestedBy ?? "", when: formatDateTime(a.createdAt) })}
              </div>
            </div>
            {canDecide && a.employeeUserId !== me.id ? (
              <DecisionButtons requestId={a.id} decide={decideAdvance} />
            ) : (
              <span className="badge self-start bg-amber-100 text-amber-800">{t("common.pending")}</span>
            )}
          </div>
        ))}
      </section>

      {canDecide && staff.length > 0 && (
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
            {t("advances.approvedThisMonth")} <b className="tabular-nums">{formatEur(approvedTotal)}</b>
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
                  <td>
                    {a.employeeLast} {a.employeeName}
                  </td>
                  <td className="text-right tabular-nums">{formatEur(a.amountCents)}</td>
                  <td>
                    <span
                      className={`badge ${
                        a.decision === "approved" ? "bg-green-100 text-green-800" : a.decision === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {a.decision ? t(a.decision === "approved" ? "decision.approved" : "decision.rejected") : t("common.pending")}
                    </span>
                  </td>
                  <td className="text-xs text-gray-500">
                    {a.decidedBy ?? ""}
                    {a.decisionNote ? ` – ${a.decisionNote}` : ""}
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
