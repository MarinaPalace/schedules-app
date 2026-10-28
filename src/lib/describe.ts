import type { Segment } from "@/db/schema";
import { absenceLabel } from "@/lib/codes";
import { formatHours, formatSegments } from "@/lib/shifts";

/** Human text for a stored schedule / timesheet / correction row. */
export function describeDay(e: { kind: string; segments: Segment[]; paidMinutes: number; absenceCode: string | null; breakMinutes?: number } | null | undefined): string {
  if (!e) return "—";
  if (e.kind === "shift") return `${formatSegments(e.segments)}${e.breakMinutes ? ` (−${e.breakMinutes} min)` : ""} · ${formatHours(e.paidMinutes)} h`;
  if (e.kind === "absence") return `${e.absenceCode} – ${absenceLabel(e.absenceCode)}`;
  if (e.kind === "off") return "Day off";
  return "—";
}
