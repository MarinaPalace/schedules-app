import type { Segment } from "@/db/schema";

/** Absence codes as used on the paper Forma 76 (labels are in messages/*.json → "absence"). Absences count 0 hours. */
export const ABSENCE_CODES = ["О", "Б", "НП", "Н"] as const;

export type AbsenceCode = (typeof ABSENCE_CODES)[number];

export function isAbsenceCode(c: unknown): c is AbsenceCode {
  return ABSENCE_CODES.includes(c as AbsenceCode);
}

/** What a manager can put in one schedule / timesheet cell. */
export type DayKind = "shift" | "off" | "absence" | "none";

/** Serializable cell value shared by server and client. */
export type DayValue = {
  kind: DayKind;
  segments: Segment[];
  paidMinutes: number;
  breakMinutes?: number;
  shiftTemplateId?: string | null;
  absenceCode?: string | null;
};

/** Translated words needed to describe a day; built with useDayLabels() / getDayLabels(). */
export type DayLabels = {
  dayOff: string;
  hourUnit: string;
  minuteUnit: string;
  /** Location names by id, to say where each block is worked (optional). */
  places?: Record<string, string>;
  absence: Record<string, string>;
};
