import type { Segment } from "@/db/schema";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(t: string): boolean {
  return TIME_RE.test(t);
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Length of one segment in minutes; end <= start means it runs past midnight. */
export function segmentMinutes(s: Segment): number {
  const start = toMinutes(s.start);
  let end = toMinutes(s.end);
  if (end <= start) end += 24 * 60;
  return end - start;
}

export function paidMinutes(segments: Segment[], breakMinutes = 0): number {
  const total = segments.reduce((sum, s) => sum + segmentMinutes(s), 0);
  return Math.max(0, total - breakMinutes);
}

export function formatSegments(segments: Segment[]): string {
  return segments.map((s) => `${s.start}–${s.end}`).join(" / ");
}

export function formatHours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h}` : h.toFixed(2).replace(/0$/, "");
}

/**
 * Parses "09:00-11:00 / 15:00-20:00" (also accepts "," or ";" between blocks
 * and "–" as dash). Returns null if anything is malformed.
 */
export function parseSegments(input: string): Segment[] | null {
  const parts = input
    .split(/[\/,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const segments: Segment[] = [];
  for (const part of parts) {
    const m = part.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
    if (!m) return null;
    const [start, end] = [m[1].padStart(5, "0"), m[2].padStart(5, "0")];
    if (!isValidTime(start) || !isValidTime(end) || start === end) return null;
    segments.push({ start, end });
  }
  return segments;
}
