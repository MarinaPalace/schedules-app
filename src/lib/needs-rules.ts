// Staffing needs: which rule applies on a date, how many of each role are needed per half hour,
// and where the plan falls short (or over). Pure functions – used on the server and in the browser.
import { countBySlot, DAY, pick, type Block } from "@/lib/coverage";

export type NeedRow = { from: string; to: string; roleId: string; count: number };
export type NeedPlan = { id: string; locationId: string; weekdays: number; seasonId: string | null; onDate: string | null; note: string | null; createdAt: string; rows: NeedRow[] };
export type SeasonLite = { id: string; name: string; fromDate: string; toDate: string; active: boolean };
/** Which kind of rule applies: one date › season › all year. */
export type Applied = { plan: NeedPlan; kind: "date" | "season" | "all"; seasonName?: string };

export const SLOT = 30;
export const ALL_DAYS = 127;
export const WEEKDAYS = 31; // Mon–Fri
export const WEEKEND = 96; // Sat–Sun

/** Monday = bit 0 … Sunday = bit 6. */
export const dayBit = (iso: string) => 1 << ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7);
const popcount = (n: number) => n.toString(2).replace(/0/g, "").length;
export const scopeKey = (p: Pick<NeedPlan, "locationId" | "weekdays" | "seasonId" | "onDate">) => `${p.locationId}|${p.weekdays}|${p.seasonId ?? ""}|${p.onDate ?? ""}`;

/** Latest version per (location, scope); rules saved empty are removed. */
export function currentPlans(all: NeedPlan[]): NeedPlan[] {
  const latest = new Map<string, NeedPlan>();
  for (const p of [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latest.set(scopeKey(p), p);
  return [...latest.values()].filter((p) => p.rows.length > 0);
}

/**
 * The rule for one location on one date: a one-off date beats a season, a season beats all year;
 * within the same kind the narrowest set of weekdays wins (e.g. "Sat–Sun" over "every day").
 */
export function planFor(plans: NeedPlan[], date: string, seasons: SeasonLite[]): Applied | null {
  const onDate = plans.find((p) => p.onDate === date);
  if (onDate) return { plan: onDate, kind: "date" };
  const bit = dayBit(date);
  const narrowest = (list: NeedPlan[]) =>
    list.filter((p) => !p.onDate && p.weekdays & bit).sort((a, b) => popcount(a.weekdays) - popcount(b.weekdays) || b.createdAt.localeCompare(a.createdAt))[0];
  const inSeason = seasons.filter((s) => s.active && s.fromDate <= date && s.toDate >= date);
  const seasonal = narrowest(plans.filter((p) => p.seasonId && inSeason.some((s) => s.id === p.seasonId)));
  if (seasonal) return { plan: seasonal, kind: "season", seasonName: seasons.find((s) => s.id === seasonal.seasonId)?.name };
  const allYear = narrowest(plans.filter((p) => !p.seasonId));
  return allYear ? { plan: allYear, kind: "all" } : null;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Needed people per half hour for each role (rows of one role that overlap add up). */
export function needSlots(rows: NeedRow[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const slots = DAY / SLOT;
  for (const r of rows) {
    const a = minutes(r.from);
    const b = r.to === "24:00" ? DAY : minutes(r.to);
    const arr = out.get(r.roleId) ?? new Array<number>(slots).fill(0);
    for (let i = 0; i < slots; i++) if (i * SLOT < b && (i + 1) * SLOT > a) arr[i] += r.count;
    out.set(r.roleId, arr);
  }
  return out;
}

export type Gap = { locationId: string; roleId: string; from: string; to: string; missing: number };

const hhmm = (m: number) => (m >= DAY ? "24:00" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

/** Runs of half hours with the same shortfall (negative = over), merged into time ranges. */
function runs(need: number[], have: number[], sign: 1 | -1) {
  const out: { from: string; to: string; n: number }[] = [];
  let start = -1;
  let cur = 0;
  for (let i = 0; i <= need.length; i++) {
    const d = i < need.length ? sign * (need[i] - have[i]) : 0;
    const v = i < need.length && need[i] > 0 && d > 0 ? d : 0;
    if (v !== cur) {
      if (cur > 0) out.push({ from: hhmm(start * SLOT), to: hhmm(i * SLOT), n: cur });
      start = i;
      cur = v;
    }
  }
  return out;
}

/**
 * Where a day's plan is short of the needs (or over them) at each location: per role,
 * the time ranges and how many people are missing / extra. `people` = each person's blocks that day.
 */
export function dayGaps(people: Block[][], needs: Record<string, NeedRow[]>) {
  const missing: Gap[] = [];
  const extra: Gap[] = [];
  for (const [locationId, rows] of Object.entries(needs)) {
    for (const [roleId, need] of needSlots(rows)) {
      const have = countBySlot(people.map((b) => pick(b, { locationId, roleId })), SLOT);
      for (const r of runs(need, have, 1)) missing.push({ locationId, roleId, from: r.from, to: r.to, missing: r.n });
      for (const r of runs(need, have, -1)) extra.push({ locationId, roleId, from: r.from, to: r.to, missing: r.n });
    }
  }
  return { missing, extra };
}

/** Hours of work a set of needs asks for (per role), e.g. to estimate their cost. */
export function neededMinutes(rows: NeedRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const b = r.to === "24:00" ? DAY : minutes(r.to);
    out.set(r.roleId, (out.get(r.roleId) ?? 0) + Math.max(0, b - minutes(r.from)) * r.count);
  }
  return out;
}
