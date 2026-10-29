import Link from "next/link";
import { cookies } from "next/headers";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/db/client";
import { departments, employees } from "@/db/schema";
import { loadAdvances } from "@/lib/advances";
import { addDays, addMonths, dateRange, dayLabel, isMonth, monthBounds, monthLabel, monthOf } from "@/lib/calendar";
import { customCodes, CUSTOM_COLOR, viewOfEntry, type CellView } from "@/lib/cell-view";
import { describeDay } from "@/lib/describe";
import { key, loadRates, loadShiftTemplates, loadTimesheet } from "@/lib/data";
import { loadCutoffs, loadPublishedSchedule } from "@/lib/published";
import { formatDateTime, hotelDate, todayISO } from "@/lib/dates";
import { href } from "@/lib/href";
import { formatEur } from "@/lib/money";
import { rateAt } from "@/lib/rates";
import { getEmployeeForUser, requireUser } from "@/lib/session";
import { formatHours } from "@/lib/shifts";
import { isOpen } from "@/lib/swap-state";
import { loadSwaps } from "@/lib/swaps";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ActionButton } from "@/components/action-button";
import { AdvanceBadge } from "@/components/advance-badge";
import { MeViewToggle } from "@/components/me-view-toggle";
import { MonthTable, type MonthTableRow } from "@/components/month-table";
import { SwapCard, SwapLine } from "@/components/swap-card";
import { PeriodNav } from "@/components/toolbar";
import { requestOwnAdvance } from "../advances/actions";
import { cancelSwap, respondSwap } from "../swaps/actions";
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

  const sp = (await searchParams) as { month?: string; view?: string; team?: string };
  // No view in the URL: use the one remembered on this device.
  const saved = sp.view ? null : (await cookies()).get("meView")?.value;
  const view = (sp.view ?? (saved === "team" ? "table" : saved)) === "table" ? "table" : "list";
  const team = view === "table" && (sp.view ? sp.team === "1" : saved === "team");
  const today = todayISO();
  const month = isMonth(sp.month) ? sp.month : monthOf(today);
  const { from, to } = monthBounds(month);
  const upcomingTo = addDays(today, 6);
  const rangeFrom = from < today ? from : today;
  const rangeTo = to > upcomingTo ? to : upcomingTo;

  // Colleagues for the department table: active ones, plus anyone (e.g. myself) needed for this month.
  const colleagues = team
    ? await db
        .select()
        .from(employees)
        .where(and(eq(employees.departmentId, emp.departmentId), or(eq(employees.active, true), eq(employees.id, emp.id))))
        .orderBy(asc(employees.lastName), asc(employees.firstName))
    : [emp];
  const ids = colleagues.map((c) => c.id);

  const [dept, schedule, timesheet, rates, templates, advances, swaps, cutoff] = await Promise.all([
    db.query.departments.findFirst({ where: eq(departments.id, emp.departmentId) }),
    loadPublishedSchedule(ids, rangeFrom, rangeTo),
    loadTimesheet([emp.id], rangeFrom, rangeTo),
    loadRates([emp.id]),
    loadShiftTemplates(),
    loadAdvances({ employeeIds: [emp.id] }),
    loadSwaps({ employeeId: emp.id, limit: 20 }),
    loadCutoffs([emp.departmentId], rangeFrom, rangeTo),
  ]);
  const legend = (id: string | null | undefined) => templates.find((tpl) => tpl.id === id);

  const { days, approvedMinutes, plannedMinutes, earnedCents, projectedCents } = summarize(dateRange(from, to), (d) => ({
    ts: timesheet.get(key(emp.id, d)),
    sc: schedule.get(key(emp.id, d)),
    rate: rateAt(rates, emp.id, d),
  }));

  const monthAdvances = advances.filter((a) => a.decision === "approved" && monthOf(hotelDate(a.createdAt)) === month);
  const advancesCents = monthAdvances.reduce((s, a) => s + a.amountCents, 0);
  const upcoming = dateRange(today, upcomingTo).map((d) => ({ date: d, sc: schedule.get(key(emp.id, d)), published: !!cutoff(emp.departmentId, d) }));

  const toAnswer = swaps.filter((s) => s.status === "waiting_colleague" && s.colleague.id === emp.id);
  const mineOpen = swaps.filter((s) => !toAnswer.includes(s) && isOpen(s.status));
  const mineDone = swaps.filter((s) => !isOpen(s.status)).slice(0, 8);

  const tableRows: MonthTableRow[] =
    view === "table"
      ? [emp, ...colleagues.filter((c) => c.id !== emp.id)].map((c) => {
          const cells: Record<string, CellView> = {};
          for (const d of dateRange(from, to)) {
            const e = schedule.get(key(c.id, d));
            if (e) cells[d] = viewOfEntry(e, templates, labels);
          }
          return { id: c.id, name: c.id === emp.id ? t("swaps.you") : `${c.lastName} ${c.firstName}`, position: c.id === emp.id ? null : c.position, isMe: c.id === emp.id, cells };
        })
      : [];

  const codes = customCodes(
    tableRows.flatMap((r) => Object.values(r.cells)),
    t("schedule.customPrefix"),
  );

  return (
    <div className={`space-y-5 ${view === "table" ? "" : "max-w-2xl"}`}>
      <div>
        <h1 className="page-title">{t("me.hello", { name: emp.firstName })}</h1>
        <p className="text-sm text-gray-500">
          {dept?.name}
          {emp.position ? ` · ${emp.position}` : ""}
        </p>
      </div>

      {toAnswer.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">{t("swaps.askedYou", { count: toAnswer.length })}</h2>
          {toAnswer.map((s) => (
            <SwapCard
              key={s.id}
              s={s}
              templates={templates}
              labels={labels}
              t={t}
              locale={locale}
              meId={emp.id}
              actions={
                <div className="flex flex-wrap gap-2">
                  <ActionButton action={respondSwap} args={[s.id, "accepted"]} className="btn btn-primary min-h-12 flex-1">
                    ✓ {t("swaps.accept")}
                  </ActionButton>
                  <ActionButton action={respondSwap} args={[s.id, "declined"]} className="btn min-h-12">
                    {t("swaps.decline")}
                  </ActionButton>
                </div>
              }
            />
          ))}
          <p className="text-xs text-gray-500">{t("swaps.acceptHelp")}</p>
        </section>
      )}

      <section className="card max-w-2xl">
        <h2 className="mb-2 text-sm font-medium">{t("me.next7")}</h2>
        <ul className="divide-y divide-gray-100">
          {upcoming.map(({ date, sc, published }) => {
            const tpl = legend(sc?.shiftTemplateId);
            return (
              <li key={date} className={`flex items-center gap-3 py-2 text-sm ${date === today ? "font-semibold" : ""}`}>
                <span className="w-24 shrink-0 text-gray-600">{date === today ? t("common.today") : dayLabel(date, locale)}</span>
                {sc && sc.kind === "shift" && tpl && (
                  <span className="rounded px-1.5 py-0.5 text-xs font-semibold text-white" style={{ background: tpl.color }}>
                    {tpl.code}
                  </span>
                )}
                <span>
                  {sc && sc.kind !== "none" ? (
                    describeDay(sc, labels)
                  ) : (
                    <span className="text-gray-400">{published ? t("me.notPlanned") : t("me.notPublished")}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodNav
          label={monthLabel(month, locale)}
          prev={href("/me", { month: addMonths(month, -1), view, team: team ? "1" : undefined })}
          next={href("/me", { month: addMonths(month, 1), view, team: team ? "1" : undefined })}
        />
      </div>

      <section className="grid max-w-2xl grid-cols-2 gap-3">
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
        <p className="col-span-2 text-xs text-gray-500">{t("me.estimateNote")}</p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MeViewToggle key={`${view}|${team}`} month={month} view={view} team={team} />
          {view === "table" && (
            <a href={href("/schedule/pdf", { dept: emp.departmentId, from, to })} target="_blank" rel="noopener" className="btn min-h-11">
              ⬇ PDF
            </a>
          )}
        </div>

        {view === "table" ? (
          <>
            <MonthTable dates={dateRange(from, to)} rows={tableRows} today={today} locale={locale} swapLabel={t("swaps.newTitle")} codes={codes} />
            <p className="text-xs text-gray-500">{t(team ? "me.tableHelpTeam" : "me.tableHelp")}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
              {templates
                .filter((tpl) => tableRows.some((r) => Object.values(r.cells).some((c) => c.tool.type === "template" && c.tool.templateId === tpl.id)))
                .map((tpl) => (
                  <span key={tpl.id} className="inline-flex items-center gap-1">
                    <span className="rounded px-1.5 py-0.5 font-semibold text-white" style={{ background: tpl.color }}>
                      {tpl.code}
                    </span>
                    {tpl.segments.map((s) => `${s.start}–${s.end}`).join(" / ")}
                    {tpl.breakMinutes ? ` (−${tpl.breakMinutes} ${labels.minuteUnit})` : ""} · {formatHours(tpl.paidMinutes)} {labels.hourUnit}
                  </span>
                ))}
              {[...codes.values()].map((r) => (
                <span key={r.key} className="inline-flex items-center gap-1">
                  <span className="rounded px-1.5 py-0.5 font-semibold text-white" style={{ background: CUSTOM_COLOR }}>
                    {r.code}
                  </span>
                  {r.times}
                  {r.breakMinutes ? ` (−${r.breakMinutes} ${labels.minuteUnit})` : ""} · {formatHours(r.paidMinutes)} {labels.hourUnit} · {t("schedule.customName")}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="card max-w-2xl">
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
          </div>
        )}
      </section>

      <section id="swaps" className="max-w-2xl scroll-mt-20 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">{t("swaps.title")}</h2>
          <Link href="/me/swap" className="btn btn-primary min-h-11">
            ⇄ {t("swaps.newTitle")}
          </Link>
        </div>
        {mineOpen.length + mineDone.length === 0 && <p className="text-sm text-gray-500">{t("swaps.mineNone")}</p>}
        {mineOpen.map((s) => (
          <SwapCard
            key={s.id}
            s={s}
            templates={templates}
            labels={labels}
            t={t}
            locale={locale}
            meId={emp.id}
            actions={
              s.requester.id === emp.id ? (
                <ActionButton action={cancelSwap} args={[s.id]} className="btn btn-sm" confirm={t("swaps.cancelConfirm")}>
                  {t("swaps.cancel")}
                </ActionButton>
              ) : undefined
            }
          />
        ))}
        {mineDone.length > 0 && (
          <ul className="card divide-y divide-gray-100 p-0 sm:p-0">
            {mineDone.map((s) => (
              <SwapLine key={s.id} s={s} t={t} locale={locale} meId={emp.id} />
            ))}
          </ul>
        )}
      </section>

      <section className="card max-w-2xl space-y-3">
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
                {!a.decision ? <span className="badge bg-amber-100 text-amber-800">{t("common.waiting")}</span> : <AdvanceBadge a={a} t={t} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
