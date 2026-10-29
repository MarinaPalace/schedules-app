import type { Segment } from "@/db/schema";
import type { DayLabels } from "@/lib/codes";
import { formatHours, formatSegments } from "@/lib/shifts";

/** Non-breaking space: keeps "8 h" and "(−30 min)" together on narrow screens. */
const NB = String.fromCharCode(0xa0);

/** Human text for a stored schedule / timesheet / correction row. */
export function describeDay(
  e: { kind: string; segments: Segment[]; paidMinutes: number; absenceCode: string | null; breakMinutes?: number } | null | undefined,
  labels: DayLabels,
): string {
  if (!e) return "—";
  if (e.kind === "shift") {
    const where = (id?: string | null) => (id && labels.places?.[id] ? ` ${labels.places[id]}` : "");
    // With places: "09:00–13:00 Main restaurant / 15:00–19:00 Pool bar".
    const times = labels.places && e.segments.some((s) => s.locationId) ? e.segments.map((s) => `${s.start}–${s.end}${where(s.locationId)}`).join(" / ") : formatSegments(e.segments);
    return `${times}${e.breakMinutes ? ` (−${e.breakMinutes}${NB}${labels.minuteUnit})` : ""} ·${NB}${formatHours(e.paidMinutes)}${NB}${labels.hourUnit}`;
  }
  if (e.kind === "absence") return `${e.absenceCode} – ${labels.absence[e.absenceCode ?? ""] ?? ""}`;
  if (e.kind === "off") return labels.dayOff;
  return "—";
}
