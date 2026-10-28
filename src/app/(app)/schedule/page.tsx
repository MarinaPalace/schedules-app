import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { addDays, addMonths, dateRange, isISODate, isMonth, mondayOf, monthBounds, monthLabel, monthOf } from "@/lib/calendar";
import { viewOfEntry, type CellView } from "@/lib/cell-view";
import { computeMonth } from "@/lib/costs";
import { getCostFactor, loadDepartmentEmployees, loadRates, loadSchedule, loadShiftTemplates, loadTimesheet } from "@/lib/data";
import { todayISO, formatDate } from "@/lib/dates";
import { canManageDepartment, getVisibleDepartments, requireUser } from "@/lib/session";
import { loadCutoffs } from "@/lib/published";
import { ScheduleBoard, type BoardMode } from "@/components/schedule-board";
import { LinkTabs, PeriodNav, href } from "@/components/toolbar";
import { getDayLabels } from "@/lib/day-labels";
import { getLocale, getTranslations } from "next-intl/server";

export default async function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  const user = await requireUser(["manager", "top_manager", "owner", "accountant", "admin"]);
  const sp = (await searchParams) as { dept?: string; view?: string; start?: string; month?: string; person?: string };
  const [t, locale, labels] = await Promise.all([getTranslations(), getLocale(), getDayLabels()]);
  const deps = await getVisibleDepartments(user);
  if (!deps.length) return <p className="text-sm text-gray-500">{t("common.noDepartments")}</p>;

  const dept = deps.find((d) => d.id === sp.dept) ?? deps[0];
  const view = sp.view === "month" ? "month" : "week";
  const today = todayISO();

  let from: string, to: string, label: string, prev: string, next: string, todayHref: string;
  if (view === "week") {
    from = mondayOf(isISODate(sp.start) ? sp.start : today);
    to = addDays(from, 6);
    label = `${formatDate(from)} – ${formatDate(to)}`;
    prev = href("/schedule", { dept: dept.id, view, start: addDays(from, -7) });
    next = href("/schedule", { dept: dept.id, view, start: addDays(from, 7) });
    todayHref = href("/schedule", { dept: dept.id, view });
  } else {
    const month = isMonth(sp.month) ? sp.month : monthOf(today);
    ({ from, to } = monthBounds(month));
    label = monthLabel(month, locale);
    prev = href("/schedule", { dept: dept.id, view, month: addMonths(month, -1) });
    next = href("/schedule", { dept: dept.id, view, month: addMonths(month, 1) });
    todayHref = href("/schedule", { dept: dept.id, view });
  }
  if (sp.dept && sp.dept !== dept.id) redirect(href("/schedule", { ...sp, dept: dept.id }));

  const employees = await loadDepartmentEmployees(dept.id, from, to);
  const ids = employees.map((e) => e.id);
  const budgetMonth = monthOf(view === "week" ? addDays(from, 3) : from);
  const [schedule, timesheet, templates, allTemplates, rates, factor, editable, costs, cutoff] = await Promise.all([
    loadSchedule(ids, from, to),
    loadTimesheet(ids, from, to),
    loadShiftTemplates(dept.id),
    loadShiftTemplates(),
    loadRates(ids),
    getCostFactor(),
    canManageDepartment(user, dept.id),
    computeMonth([dept.id], budgetMonth),
    loadCutoffs([dept.id], from, to),
  ]);

  const cells: Record<string, CellView> = {};
  for (const [k, e] of schedule) cells[k] = viewOfEntry(e, allTemplates, labels);
  // Plan changes made after the last publication of that day (employees don't see them yet).
  const unpublished: Record<string, true> = {};
  for (const [k, e] of schedule) {
    const c = cutoff(e.departmentId, e.workDate);
    if (c ? e.createdAt > c : e.kind !== "none") unpublished[k] = true;
  }
  const approved: Record<string, true> = {};
  for (const k of timesheet.keys()) approved[k] = true;
  const m = costs.get(dept.id)!;
  // Remembered choice, otherwise "day" on phones and "table" on bigger screens.
  const savedMode = (await cookies()).get("scheduleMode")?.value;
  const isPhone = /Mobi|Android|iPhone/i.test((await headers()).get("user-agent") ?? "");
  const defaultMode: BoardMode = sp.person ? "person" : savedMode === "day" || savedMode === "person" || savedMode === "table" ? savedMode : isPhone ? "day" : "table";
  const lite = ({ id, code, name, color, segments, paidMinutes }: (typeof allTemplates)[number]) => ({ id, code, name, color, segments, paidMinutes });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-2">{t("schedule.title")}</h1>
        <LinkTabs base="/schedule" params={{ view, start: sp.start, month: sp.month }} name="dept" value={dept.id} options={deps.map((d) => ({ value: d.id, label: d.name }))} />
        <LinkTabs base="/schedule" params={{ dept: dept.id }} name="view" value={view} options={[{ value: "week", label: t("common.weekView") }, { value: "month", label: t("common.monthView") }]} />
        <PeriodNav label={label} prev={prev} next={next} today={todayHref} />
      </div>
      <ScheduleBoard
        key={`${dept.id}|${from}`}
        departmentId={dept.id}
        dates={dateRange(from, to)}
        employees={employees.map((e) => ({ id: e.id, name: `${e.lastName} ${e.firstName}`, position: e.position }))}
        initialCells={cells}
        approved={approved}
        templates={templates.map(lite)}
        allTemplates={allTemplates.map(lite)}
        rates={Object.fromEntries(rates)}
        factor={factor}
        editable={editable}
        today={today}
        budget={{ month: budgetMonth, budgetCents: m.budgetCents, projectedCents: m.projectedCents }}
        weekStart={view === "week" ? from : null}
        unpublished={unpublished}
        defaultMode={defaultMode}
        initialPerson={sp.person ?? null}
      />
      {!editable && <p className="text-sm text-gray-500">{t("common.readOnly")}</p>}
    </div>
  );
}
