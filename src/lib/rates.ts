/** Rate history per employee, sorted by start date. */
export type RateBook = Map<string, { from: string; cents: number }[]>;
export type RateBookJSON = Record<string, { from: string; cents: number }[]>;

/** Hourly gross rate in cents valid on `date` (0 if none yet). */
export function rateAt(book: RateBook | RateBookJSON, employeeId: string, date: string): number {
  const list = book instanceof Map ? book.get(employeeId) : book[employeeId];
  if (!list) return 0;
  let cents = 0;
  for (const r of list) {
    if (r.from <= date) cents = r.cents;
    else break;
  }
  return cents;
}

/** Employer cost of `minutes` of work in cents. */
export function costCents(minutes: number, rateCents: number, factor: number): number {
  return Math.round((minutes / 60) * rateCents * factor);
}
