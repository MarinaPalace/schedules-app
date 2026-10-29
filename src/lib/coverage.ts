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

/** A stretch of work on one calendar day, with where and as what. */
export type Block = { start: number; end: number; locationId: string | null; roleId: string | null };
type Day = { segments?: Segment[]; roleId?: string | null } | undefined;

/**
 * Working time that falls on a calendar day: the day's own blocks (cut at midnight)
 * plus the part of yesterday's overnight shift after midnight.
 */
export function dayBlocks(today: Day, yesterday?: Day): Block[] {
  const blocks = (d: Day) => (d?.segments ?? []).map((s, i) => ({ iv: intervalsOf([s])[0], s, i, roleId: d?.roleId ?? null }));
  const own = blocks(today).map(({ iv: [a, b], s, roleId }) => ({ start: a, end: Math.min(b, DAY), locationId: s.locationId ?? null, roleId }));
  const spill = blocks(yesterday)
    .filter(({ iv: [, b] }) => b > DAY)
    .map(({ iv: [, b], s, roleId }) => ({ start: 0, end: b - DAY, locationId: s.locationId ?? null, roleId }));
  return [...spill, ...own].filter((x) => x.end > x.start);
}

export function dayIntervals(today: Segment[] | undefined, yesterday?: Segment[]): Interval[] {
  return dayBlocks({ segments: today }, { segments: yesterday }).map((b): Interval => [b.start, b.end]);
}

/** Intervals of the blocks at a place (null/undefined = anywhere) with a role (undefined = any role, null = without a role). */
export function pick(blocks: Block[], where: { locationId?: string | null; roleId?: string | null }): Interval[] {
  return blocks
    .filter((b) => (where.locationId == null || b.locationId === where.locationId) && (where.roleId === undefined || b.roleId === where.roleId))
    .map((b): Interval => [b.start, b.end]);
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
