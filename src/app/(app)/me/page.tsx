import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { departments } from "@/db/schema";
import { loadAdvances } from "@/lib/advances";
import { addDays, addMonths, dateRange, dayLabel, isMonth, monthBounds, monthLabel, monthOf } from "@/lib/calendar";
import { describeDay } from "@/lib/describe";
import { key, loadRates, loadShiftTemplates, loadTimesheet } from "@/lib/data";
import { loadPublishedSchedule } from "@/lib/published";
import { formatDateTime, hotelDate, todayISO } from "@/lib/dates";
import { formatEur } from "@/lib/money";
import { rateAt } from "@/lib/rates";
import { getEmployeeForUser, requireUser } from "@/lib/session";
import { formatHours } from "@/lib/shifts";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PeriodNav, href } from "@/components/toolbar";
import { requestOwnAdvance } from "../advances/actions";
import { getDayLabels } from "@/lib/day-labels";
import { getLocale, getTranslations } from "next-intl/server";

type Day<T, S> = { ts?: T; sc?: S; rate: number };

/** Month totals: approved days count as earned, the rest of the schedule as projected. */
function summarize<T extends { paidMinutes: number }, S extends { paidMinutes: number }>(dates: string[], get: (d: string) => Day<T, S>) {
  const totals = { approvedMinutes: 0, plannedMinutes: 0, earnedCents: 0, projectedCents: 0 };
  const days = dates.map((date) => {
    const { ts, sc, rate } = get(date);
    if (ts) {
      const cents = Math.round((ts.paidMinutes / 60) * rate);
      totals.approvedMinutes += ts.paidMinutes;
      totals.earnedCents += cents;
      totals.projectedCents += cents;
    } else if (sc) {
      totals.plannedMinutes += sc.paidMinutes;
      totals.projectedCents += Math.round((sc.paidMinutes / 60) * rate);
    }
    return { date, ts, sc };
  });
  return { days, ...totals };
}

export default async function MePage({ searchParams }: PageProps<"/me">) {
  const user = await requireUser();
  const emp = await getEmployeeForUser(user.id);
  const [t, locale, labels] = await Promise.all([getTranslations(), getLocale(), getDayLabels()]);
  if (!emp) {
    return (
      <div className="max-w-xl space-y-2">
        <h1 className="page-title">{t("me.title")}</h1>
        <p className="text-sm text-gray-500">{t("me.notLinked")}</p>
      </div>
    );
  }

  const sp = (await searchParams) as { month?: string };
  const today = todayISO();
  const month = isMonth(sp.month) ? sp.month : monthOf(today);
  const { from, to } = monthBounds(month);
  const upcomingTo = addDays(today, 6);
  const rangeFrom = from < today ? from : today;
  const rangeTo = to > upcomingTo ? to : upcomingTo;

  const [dept, schedule, timesheet, rates, templates, advances] = await Promise.all([
    db.query.departments.findFirst({ where: eq(departments.id, emp.departmentId) }),
    loadPublishedSchedule([emp.id], rangeFrom, rangeTo),
    loadTimesheet([emp.id], rangeFrom, rangeTo),
    loadRates([emp.id]),
    loadShiftTemplates(),
    loadAdvances({ employeeIds: [emp.id] }),
  ]);
  const legend = (id: string | null | undefined) => templates.find((tpl) => tpl.id === id);

  const { days, approvedMinutes, plannedMinutes, earnedCents, projectedCents } = summarize(dateRange(from, to), (d) => ({
    ts: timesheet.get(key(emp.id, d)),
    sc: schedule.get(key(emp.id, d)),
    rate: rateAt(rates, emp.id, d),
  }));

  const monthAdvances = advances.filter((a) => a.decision === "approved" && monthOf(hotelDate(a.createdAt)) === month);
  const advancesCents = monthAdvances.reduce((s, a) => s + a.amountCents, 0);
  const upcoming = dateRange(today, upcomingTo).map((d) => ({ date: d, sc: schedule.get(key(emp.id, d)) }));

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="page-title">{t("me.hello", { name: emp.firstName })}</h1>
        <p className="text-sm text-gray-500">
          {dept?.name}
          {emp.position ? ` · ${emp.position}` : ""}
          {emp.canViewDepartment && (
            <>
              {" · "}
              <Link href="/me/department" className="text-blue-700 hover:underline">
                {t("me.departmentSchedule")}
              </Link>
            </>
          )}
        </p>
      </div>

      <section className="card">
        <h2 className="mb-2 text-sm font-medium">{t("me.next7")}</h2>
        <ul className="divide-y divide-gray-100">
          {upcoming.map(({ date, sc }) => {
            const tpl = legend(sc?.shiftTemplateId);
            return (
              <li key={date} className={`flex items-center gap-3 py-2 text-sm ${date === today ? "font-semibold" : ""}`}>
                <span className="w-24 shrink-0 text-gray-600">{date === today ? t("common.today") : dayLabel(date, locale)}</span>
                {sc && sc.kind === "shift" && tpl && (
                  <span className="rounded px-1.5 py-0.5 text-xs font-semibold text-white" style={{ background: tpl.color }}>
                    {tpl.code}
                  </span>
                )}
                <span>{sc && sc.kind !== "none" ? describeDay(sc, labels) : <span className="text-gray-400">{t("me.notPlanned")}</span>}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex items-center justify-between">
        <PeriodNav label={monthLabel(month, locale)} prev={href("/me", { month: addMonths(month, -1) })} next={href("/me", { month: addMonths(month, 1) })} />
      </div>

      <section className="grid grid-cols-2 gap-3">
        <div className="card">
          <div className="text-xs text-gray-500">{t("me.approvedHours")}</div>
          <div className="text-2xl font-semibold tabular-nums">{formatHours(approvedMinutes)}</div>
          <div className="text-xs text-gray-500">{t("me.stillPlanned", { hours: formatHours(plannedMinutes) })}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500">{t("me.estimatedPay")}</div>
          <div className="text-2xl font-semibold tabular-nums">{formatEur(projectedCents)}</div>
          <div className="text-xs text-gray-500">{t("me.earned", { amount: formatEur(earnedCents) })}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500">{t("me.advancesApproved")}</div>
          <div className="text-2xl font-semibold tabular-nums">{formatEur(advancesCents)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500">{t("me.expectedRest")}</div>
          <div className="text-2xl font-semibold tabular-nums">{formatEur(Math.max(0, projectedCents - advancesCents))}</div>
        </div>
        <p className="col-span-2 text-xs text-gray-500">
          {t("me.estimateNote")}
        </p>
      </section>

      <section className="card">
        <h2 className="mb-2 text-sm font-medium">{t("me.daysIn", { month: monthLabel(month, locale) })}</h2>
        <ul className="divide-y divide-gray-100 text-sm">
          {days
            .filter(({ ts, sc }) => ts || (sc && sc.kind !== "none"))
            .map(({ date, ts, sc }) => (
              <li key={date} className="flex flex-wrap items-center gap-x-3 py-2">
                <span className={`w-24 shrink-0 ${date === today ? "font-semibold" : "text-gray-600"}`}>{dayLabel(date, locale)}</span>
                <span className="flex-1">{describeDay(ts ?? sc, labels)}</span>
                {ts ? <span className="badge bg-green-100 text-green-800">{t("common.approved")}</span> : <span className="badge">{t("me.plannedBadge")}</span>}
              </li>
            ))}
          {days.every(({ ts, sc }) => !ts && (!sc || sc.kind === "none")) && <li className="py-2 text-gray-500">{t("me.nothingThisMonth")}</li>}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-medium">{t("me.advanceTitle")}</h2>
        <ActionForm action={requestOwnAdvance} resetOnSuccess className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">{t("common.amountEur")}</label>
            <input name="amount" className="input w-28" inputMode="decimal" required />
          </div>
          <div className="min-w-40 flex-1">
            <label className="label">{t("common.noteOptional")}</label>
            <input name="note" className="input" />
          </div>
          <SubmitButton>{t("me.request")}</SubmitButton>
        </ActionForm>
        {advances.length > 0 && (
          <ul className="divide-y divide-gray-100 text-sm">
            {advances.slice(0, 10).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 py-2">
                <span className="w-32 text-gray-600">{formatDateTime(a.createdAt).split(",")[0]}</span>
                <span className="flex-1 font-medium tabular-nums">{formatEur(a.amountCents)}</span>
                <span
                  className={`badge ${
                    a.decision === "approved" ? "bg-green-100 text-green-800" : a.decision === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {a.decision ? t(a.decision === "approved" ? "decision.approved" : "decision.rejected") : t("common.waiting")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
