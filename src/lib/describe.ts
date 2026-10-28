import type { Segment } from "@/db/schema";
import type { DayLabels } from "@/lib/codes";
import { formatHours, formatSegments } from "@/lib/shifts";

/** Human text for a stored schedule / timesheet / correction row. */
export function describeDay(
  e: { kind: string; segments: Segment[]; paidMinutes: number; absenceCode: string | null; breakMinutes?: number } | null | undefined,
  labels: DayLabels,
): string {
  if (!e) return "—";
  if (e.kind === "shift") {
    return `${formatSegments(e.segments)}${e.breakMinutes ? ` (−${e.breakMinutes} min)` : ""} · ${formatHours(e.paidMinutes)} ${labels.hourUnit}`;
  }
  if (e.kind === "absence") return `${e.absenceCode} – ${labels.absence[e.absenceCode ?? ""] ?? ""}`;
  if (e.kind === "off") return labels.dayOff;
  return "—";
}
