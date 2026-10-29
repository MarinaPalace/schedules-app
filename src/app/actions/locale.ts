"use server";

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { getCurrentUser } from "@/lib/session";

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // Signed in: email/Telegram messages follow the same language.
  const me = await getCurrentUser();
  if (me) await db.update(user).set({ locale }).where(eq(user.id, me.id));
}
