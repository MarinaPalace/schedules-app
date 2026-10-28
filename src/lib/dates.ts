export const HOTEL_TZ = "Europe/Sofia";

/** Today's date (YYYY-MM-DD) in the hotel's time zone. */
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: HOTEL_TZ }).format(new Date());
}

/** Calendar date (YYYY-MM-DD) of a timestamp in the hotel's time zone. */
export function hotelDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: HOTEL_TZ }).format(d);
}

export function formatDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: HOTEL_TZ,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(d);
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
