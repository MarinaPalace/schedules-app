import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, localeFromHeader } from "./config";

// Language: saved choice (cookie) → browser language → Bulgarian.
export default getRequestConfig(async () => {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(saved) ? saved : (localeFromHeader((await headers()).get("accept-language")) ?? DEFAULT_LOCALE);
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Europe/Sofia",
  };
});
