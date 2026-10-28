export const LOCALES = ["bg", "en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "bg";
export const LOCALE_COOKIE = "locale";

export const LOCALE_LABELS: Record<Locale, string> = {
  bg: "Български",
  en: "English",
  ru: "Русский",
};

export function isLocale(v: unknown): v is Locale {
  return LOCALES.includes(v as Locale);
}

/** Picks the best supported language from an Accept-Language header. */
export function localeFromHeader(header: string | null): Locale | null {
  if (!header) return null;
  const wanted = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { lang: tag.slice(0, 2).toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  return wanted.find((w) => isLocale(w.lang))?.lang as Locale | undefined ?? null;
}
