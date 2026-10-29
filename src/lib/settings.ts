import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { settings } from "@/db/schema";
import type { Tx } from "@/lib/actor";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

// Hotel-wide settings (key/value). Keys in use: hotel_name, default_locale, employer_cost_factor,
// welcome_done, and per user: checklist_hidden:<userId>, intro_seen:<userId>.

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {};
  const rows = await db.select().from(settings).where(inArray(settings.key, keys));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  return row?.value ?? null;
}

export async function setSetting(tx: Tx, key: string, value: string) {
  await tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** The hotel's name, or null while the owner hasn't set it ("Hotel" is the placeholder of a new install). */
export async function getHotelName(): Promise<string | null> {
  const name = (await getSetting("hotel_name"))?.trim();
  return name && name !== "Hotel" ? name : null;
}

/** Language for new accounts (their messages until they pick one). */
export async function getDefaultLocale(q: Pick<Tx, "query"> = db): Promise<Locale> {
  const row = await q.query.settings.findFirst({ where: eq(settings.key, "default_locale") });
  return isLocale(row?.value) ? row.value : DEFAULT_LOCALE;
}
