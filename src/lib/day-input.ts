import { z } from "zod";
import type { ErrorKey } from "@/lib/app-error";
import { isAbsenceCode, type DayValue } from "@/lib/codes";
import { paidMinutes, parseSegments } from "@/lib/shifts";

/** What a manager types for one employee-day in Forma 76. */
export const dayInputSchema = z.object({
  kind: z.enum(["shift", "off", "absence", "none"]),
  hours: z.string().default(""),
  breakMinutes: z.coerce.number().int().min(0).max(600).default(0),
  absenceCode: z.string().nullable().default(null),
});
export type DayInput = z.infer<typeof dayInputSchema>;

/** Converts input to a stored value, or returns an error key (messages → errors). */
export function toDayValue(input: DayInput): DayValue | ErrorKey {
  if (input.kind === "shift") {
    const segments = parseSegments(input.hours);
    if (!segments) return "hoursFormat";
    const paid = paidMinutes(segments, input.breakMinutes);
    if (paid <= 0) return "breakTooLong";
    return { kind: "shift", segments, breakMinutes: input.breakMinutes, paidMinutes: paid };
  }
  if (input.kind === "absence") {
    if (!isAbsenceCode(input.absenceCode)) return "chooseAbsence";
    return { kind: "absence", segments: [], paidMinutes: 0, absenceCode: input.absenceCode };
  }
  return { kind: input.kind, segments: [], paidMinutes: 0 };
}

/** Pre-fills the input from a stored schedule/timesheet row. */
export function inputFromEntry(e?: { kind: string; segments: { start: string; end: string }[]; breakMinutes: number; absenceCode: string | null } | null): DayInput {
  if (!e) return { kind: "none", hours: "", breakMinutes: 0, absenceCode: null };
  return {
    kind: e.kind as DayInput["kind"],
    hours: e.segments.map((s) => `${s.start}-${s.end}`).join(" / "),
    breakMinutes: e.breakMinutes,
    absenceCode: e.absenceCode,
  };
}

export function sameDay(a: DayValue, b: { kind: string; segments: { start: string; end: string }[]; paidMinutes: number; absenceCode: string | null }) {
  return a.kind === b.kind && a.paidMinutes === b.paidMinutes && JSON.stringify(a.segments) === JSON.stringify(b.segments) && (a.absenceCode ?? null) === (b.absenceCode ?? null);
}
