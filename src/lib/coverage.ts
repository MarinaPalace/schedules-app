import type { Segment } from "@/db/schema";

// Staffing over the day: who is at work when. Pure functions, used by the timeline view
// (and meant for the future AI schedule assistant to check suggestions against needs).

export const DAY = 24 * 60;
export type Interval = [start: number, end: number];

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Minutes from the day's midnight; a block that ends at or before its start runs past midnight (end > 1440). */
export function intervalsOf(segments: Segment[] | undefined): Interval[] {
  return (segments ?? []).map((s) => {
    const start = toMinutes(s.start);
    let end = toMinutes(s.end);
    if (end <= start) end += DAY;
    return [start, end];
  });
}

/**
 * Working time that falls on a calendar day: the day's own blocks (cut at midnight)
 * plus the part of yesterday's overnight shift after midnight.
 */
export function dayIntervals(today: Segment[] | undefined, yesterday?: Segment[]): Interval[] {
  const own = intervalsOf(today).map(([a, b]): Interval => [a, Math.min(b, DAY)]);
  const spill = intervalsOf(yesterday)
    .filter(([, b]) => b > DAY)
    .map(([, b]): Interval => [0, b - DAY]);
  return [...spill, ...own].filter(([a, b]) => b > a);
}

/** How many people work in each slot of the day (a person counts if they work any part of the slot). */
export function countBySlot(people: Interval[][], slotMinutes = 30): number[] {
  const slots = Math.ceil(DAY / slotMinutes);
  const counts = new Array<number>(slots).fill(0);
  for (const intervals of people) {
    for (let i = 0; i < slots; i++) {
      const a = i * slotMinutes;
      const b = a + slotMinutes;
      if (intervals.some(([s, e]) => s < b && e > a)) counts[i]++;
    }
  }
  return counts;
}

export type Presence = "full" | "part" | "none";

/** Is the person there for the whole of [from, to), only part of it, or not at all? */
export function presenceBetween(intervals: Interval[], from: number, to: number): Presence {
  let covered = 0;
  // Merge overlaps so split shifts and double entries count once.
  const sorted = intervals
    .map(([a, b]): Interval => [Math.max(a, from), Math.min(b, to)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let end = from;
  for (const [a, b] of sorted) {
    if (b <= end) continue;
    covered += b - Math.max(a, end);
    end = b;
  }
  if (covered <= 0) return "none";
  return covered >= to - from ? "full" : "part";
}

/** Lowest number of people working at any moment in [from, to) – the "is it covered?" number. */
export function minStaff(people: Interval[][], from: number, to: number, slotMinutes = 15): number {
  let min = Infinity;
  for (let a = from; a < to; a += slotMinutes) {
    const b = Math.min(a + slotMinutes, to);
    min = Math.min(min, people.filter((iv) => iv.some(([s, e]) => s <= a && e >= b)).length);
  }
  return min === Infinity ? 0 : min;
}

export const minutesLabel = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
