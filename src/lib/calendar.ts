// Pure date helpers on "YYYY-MM-DD" strings (UTC arithmetic, no time zone surprises).

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isISODate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toDate(s).getTime());
}

export function isMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

/** Inclusive list of dates. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function mondayOf(iso: string): string {
  const dow = (toDate(iso).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -dow);
}

/** "2026-10" -> first and last day. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return toISO(d).slice(0, 7);
}

export function weekdayShort(iso: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(toDate(iso));
}

export function isWeekend(iso: string): boolean {
  const d = toDate(iso).getUTCDay();
  return d === 0 || d === 6;
}

export function dayLabel(iso: string, locale = "en"): string {
  return `${weekdayShort(iso, locale)} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

export function monthLabel(month: string, locale = "en"): string {
  const s = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(toDate(`${month}-01`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
