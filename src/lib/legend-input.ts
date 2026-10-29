import { z } from "zod";
import { AppError } from "@/lib/app-error";
import { paidMinutes, parseSegments } from "@/lib/shifts";

/** Shared checks for a shift legend (admin legend page and "save as legend" in the schedule). */
export const legendFields = z.object({
  code: z
    .string()
    .trim()
    .min(1, "codeRequired")
    .max(6, "codeLength")
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "nameTooShort"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "invalidColor"),
  breakMinutes: z.coerce.number().int().min(0).max(240),
});

/** Hours text + break → segments and paid minutes; throws a translated error key. */
export function legendHours(text: string, breakMinutes: number) {
  const segments = parseSegments(text);
  if (!segments) throw new AppError("hoursFormat");
  const paid = paidMinutes(segments, breakMinutes);
  if (paid <= 0) throw new AppError("breakTooLong");
  return { segments, paidMinutes: paid };
}
