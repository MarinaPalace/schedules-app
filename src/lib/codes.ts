import type { Segment } from "@/db/schema";

/** Absence codes as used on the paper Forma 76. Absences count 0 hours in cost estimates. */
export const ABSENCE_CODES = [
  { code: "О", label: "Annual leave" },
  { code: "Б", label: "Sick leave" },
  { code: "НП", label: "Unpaid leave" },
  { code: "Н", label: "Absent (unexcused)" },
] as const;

export type AbsenceCode = (typeof ABSENCE_CODES)[number]["code"];

export function isAbsenceCode(c: unknown): c is AbsenceCode {
  return ABSENCE_CODES.some((a) => a.code === c);
}

export function absenceLabel(code: string | null): string {
  return ABSENCE_CODES.find((a) => a.code === code)?.label ?? code ?? "";
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

export const EMPTY_DAY: DayValue = { kind: "none", segments: [], paidMinutes: 0 };
