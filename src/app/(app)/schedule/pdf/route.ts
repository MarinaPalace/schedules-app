import { eq } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/db/client";
import { departments } from "@/db/schema";
import { dateRange, daysBetween, isISODate, isWeekend, monthBounds, monthLabel, monthOf, weekdayShort } from "@/lib/calendar";
import { cellLabel, customCodes, CUSTOM_COLOR, paidAt, viewOfEntry, type CellView } from "@/lib/cell-view";
import { ABSENCE_CODES } from "@/lib/codes";
import { key, loadDepartmentEmployees, loadSchedule, loadShiftTemplates } from "@/lib/data";
import { getDayLabels } from "@/lib/day-labels";
import { formatDate, formatDateTime, todayISO } from "@/lib/dates";
import { isPublished, loadCutoffs, loadPublishedSchedule } from "@/lib/published";
import { renderSchedulePdf, type PdfCell } from "@/lib/schedule-pdf";
import { loadLocations } from "@/lib/org";
import { getHotelName } from "@/lib/settings";
import { getCurrentUser, getEmployeeForUser, getVisibleDepartments } from "@/lib/session";
import { formatHours } from "@/lib/shifts";

/** "07:00–15:00" → "07–15"; keeps minutes when they are not :00. */
const shortTime = (t: string) => (t.endsWith(":00") ? t.slice(0, 2) : t);

/**
 * Schedule of one department as PDF (A4 landscape) with a legend of the hours.
 * Managers get the current plan; employees get what has been published for their own department.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const deptId = url.searchParams.get("dept") ?? "";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isISODate(from) || !isISODate(to) || from > to || daysBetween(from, to) > 41) return new Response("Bad period", { status: 400 });

  const manages = (await getVisibleDepartments(user)).some((d) => d.id === deptId);
  const me = await getEmployeeForUser(user.id);
  if (!manages && !(me?.active && me.departmentId === deptId)) return new Response("Forbidden", { status: 403 });
  const dept = await db.query.departments.findFirst({ where: eq(departments.id, deptId) });
  if (!dept) return new Response("Not found", { status: 404 });

  const [t, locale, labels] = await Promise.all([getTranslations(), getLocale(), getDayLabels()]);
  const allPeople = (await loadDepartmentEmployees(dept.id, from, to)).filter((e) => manages || e.active);
  // ?location=…: that place's own schedule – only the people and the blocks worked there.
  const place = (await loadLocations([dept.id])).find((l) => l.id === url.searchParams.get("location")) ?? null;
  const ids = allPeople.map((e) => e.id);
  const [plan, templates, cutoff] = await Promise.all([
    manages ? loadSchedule(ids, from, to) : loadPublishedSchedule(ids, from, to),
    loadShiftTemplates(),
    loadCutoffs([dept.id], from, to),
  ]);
  const unpublished = manages && [...plan.values()].some((e) => !isPublished(e, cutoff) && (e.kind !== "none" || cutoff(e.departmentId, e.workDate)));

  const dates = dateRange(from, to);
  const today = todayISO();
  const used = new Set<string>();
  const views = new Map<string, CellView>();
  for (const p of allPeople) {
    for (const d of dates) {
      const e = plan.get(key(p.id, d));
      if (!e || e.kind === "none") continue;
      // At one location, a shift elsewhere is left out (the person is not there that day).
      if (place && e.kind === "shift" && !e.segments.some((s) => s.locationId === place.id)) continue;
      views.set(key(p.id, d), viewOfEntry(e, templates, labels));
    }
  }
  const people = place ? allPeople.filter((p) => p.homeLocationId === place.id || dates.some((d) => views.get(key(p.id, d))?.kind === "shift")) : allPeople;
  // Hours entered without a legend get the same automatic codes as on screen, and a legend line.
  const codes = customCodes(views.values(), t("schedule.customPrefix"));
  const dayMinutes = dates.map(() => 0);
  const rows = people.map((p) => {
    let minutes = 0;
    const cells = dates.map((d, i): PdfCell => {
      const e = plan.get(key(p.id, d));
      const v = views.get(key(p.id, d));
      if (!e || !v) return { kind: "none", label: "", color: null };
      const paid = paidAt(v, place?.id ?? null);
      minutes += paid;
      dayMinutes[i] += paid;
      if (e.shiftTemplateId && v.tool.type === "template") used.add(e.shiftTemplateId);
      const blocks = place ? e.segments.filter((s) => s.locationId === place.id) : e.segments;
      const sub = e.kind === "shift" ? blocks.map((s) => `${shortTime(s.start)}–${shortTime(s.end)}`).join(" / ") : undefined;
      return { kind: v.kind, label: cellLabel(v, codes), sub, color: v.color };
    });
    return { name: `${p.lastName} ${p.firstName}`, position: p.position, cells, hours: formatHours(minutes), highlight: !manages && p.id === me?.id };
  });

  const deptTemplates = templates.filter((tpl) => !tpl.departmentId || tpl.departmentId === dept.id);
  const legendTemplates = used.size || codes.size ? templates.filter((tpl) => used.has(tpl.id)) : deptTemplates;
  const isMonth = from === monthBounds(monthOf(from)).from && to === monthBounds(monthOf(from)).to;
  const period = isMonth ? monthLabel(monthOf(from), locale) : `${formatDate(from)} – ${formatDate(to)}`;

  const pdf = await renderSchedulePdf({
    title: `${t("schedule.title")} · ${dept.name}${place ? ` · ${place.code} ${place.name}` : ""}`,
    subtitle: [await getHotelName(), period, unpublished ? t("pdf.includesUnpublished") : null].filter(Boolean).join(" · "),
    generated: t("pdf.generated", { when: formatDateTime(new Date()) }),
    days: dates.map((d) => ({
      top: weekdayShort(d, locale),
      bottom: dates.length <= 7 ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : d.slice(8, 10),
      weekend: isWeekend(d),
      today: d === today,
    })),
    rows,
    dayTotals: dayMinutes.map((m) => (m ? formatHours(m) : "")),
    totalHours: formatHours(dayMinutes.reduce((a, b) => a + b, 0)),
    legend: legendTemplates.map((tpl) => ({
      code: tpl.code,
      color: tpl.color,
      name: tpl.name,
      times: tpl.segments.map((s) => `${s.start}–${s.end}`).join(" / ") + (tpl.breakMinutes ? ` (−${tpl.breakMinutes} ${labels.minuteUnit})` : ""),
      hours: `${formatHours(tpl.paidMinutes)} ${labels.hourUnit}`,
    })).concat(
      [...codes.values()].map((r) => ({
        code: r.code,
        color: CUSTOM_COLOR,
        name: t("schedule.customName"),
        times: r.times + (r.breakMinutes ? ` (−${r.breakMinutes} ${labels.minuteUnit})` : ""),
        hours: `${formatHours(r.paidMinutes)} ${labels.hourUnit}`,
      })),
    ),
    symbols: [
      { code: "–", text: labels.dayOff, kind: "off" as const },
      ...ABSENCE_CODES.map((c) => ({ code: c, text: labels.absence[c], kind: "absence" as const })),
    ],
    labels: {
      employee: t("common.employee"),
      hours: t("common.hours"),
      total: t("common.totalHours"),
      legend: t("pdf.legend"),
      page: (n, of) => t("pdf.page", { n, of }),
    },
  });

  const safe = dept.name.replace(/[^\p{L}\p{N}_-]+/gu, "_");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // ASCII fallback name + the real (possibly Cyrillic) department name for browsers that support it.
      "Content-Disposition": `inline; filename="schedule-${from}.pdf"; filename*=UTF-8''schedule-${encodeURIComponent(safe)}-${from}.pdf`,
      "Cache-Control": "private, no-store",
    },
  });
}
