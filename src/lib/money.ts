const eur = new Intl.NumberFormat("bg-BG", { style: "currency", currency: "EUR" });

export function formatEur(cents: number): string {
  return eur.format(cents / 100);
}

/** "12.50" or "12,50" -> 1250; null if invalid. */
export function parseEurToCents(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** "6.25" per hour, or "1000/160" = 1000 € for 160 hours. */
export function parsePayPerHour(text: string): number | null {
  const m = text.trim().replace(/\s/g, "").replace(/€/g, "").match(/^(\d+(?:[.,]\d+)?)(?:\/(\d+(?:[.,]\d+)?))?$/);
  if (!m) return null;
  const amount = Number(m[1].replace(",", "."));
  const hours = m[2] ? Number(m[2].replace(",", ".")) : 1;
  const cents = Math.round((amount / hours) * 100);
  return cents > 0 && cents < 100000 ? cents : null;
}
