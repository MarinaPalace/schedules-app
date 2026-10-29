import "server-only";
import { after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { db } from "@/db/client";
import { notifications, user } from "@/db/schema";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { appUrl } from "@/lib/app-url";
import { getHotelName } from "@/lib/settings";
import { emailConfigured, sendEmail, sendTelegram, telegramConfigured } from "@/lib/notify/channels";
import bg from "../../../messages/bg.json";
import en from "../../../messages/en.json";
import ru from "../../../messages/ru.json";

const MESSAGES = { bg, en, ru } as Record<Locale, typeof en>;

export type Recipient = typeof user.$inferSelect;
export type NotifyT = ReturnType<typeof translatorFor>;

/** What one person receives. `secretLink` = a login link: sent, but never stored in the log. */
export type Message = { kind: string; subject: string; lines: string[]; link?: string; linkLabel?: string; secretLink?: boolean };
export type Compose = (t: NotifyT, r: Recipient, locale: Locale) => Message | null;

export function translatorFor(locale: Locale) {
  return createTranslator({ locale, messages: MESSAGES[locale], timeZone: "Europe/Sofia" });
}

export type Delivery = { email: "sent" | "failed" | "none"; telegram: "sent" | "failed" | "none" };

/**
 * Sends a message to each user over the channels they have (email and/or Telegram) and logs it.
 * `force` ignores the person's "notify me" switches (used for login links and security notices).
 */
export async function deliver(userIds: string[], compose: Compose, opts: { force?: boolean } = {}): Promise<Map<string, Delivery>> {
  const result = new Map<string, Delivery>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return result;
  const [people, hotel] = await Promise.all([db.select().from(user).where(and(inArray(user.id, ids), eq(user.active, true))), getHotelName()]);

  for (const r of people) {
    const locale: Locale = isLocale(r.locale) ? r.locale : DEFAULT_LOCALE;
    const msg = compose(translatorFor(locale), r, locale);
    const status: Delivery = { email: "none", telegram: "none" };
    result.set(r.id, status);
    if (!msg) continue;
    const t = translatorFor(locale);
    const link = msg.link ? (msg.link.startsWith("http") ? msg.link : appUrl(msg.link)) : null;
    const label = msg.linkLabel ?? t("notify.open");
    const text = [...msg.lines, ...(link ? ["", `${label}: ${link}`] : [])].join("\n");
    const logged = link && msg.secretLink ? text.replace(link, "[link]") : text;
    const subject = `${hotel ?? t("common.appName")}: ${msg.subject}`;

    const channels: { channel: "email" | "telegram"; to: string; ok: boolean; send: () => Promise<void> }[] = [];
    if (r.contactEmail && (opts.force || r.notifyEmail)) {
      channels.push({ channel: "email", to: r.contactEmail, ok: emailConfigured(), send: () => sendEmail(r.contactEmail!, subject, text, emailHtml(msg.lines, link, label)) });
    }
    if (r.telegramChatId && (opts.force || r.notifyTelegram)) {
      channels.push({ channel: "telegram", to: r.telegramChatId, ok: telegramConfigured(), send: () => sendTelegram(r.telegramChatId!, `${msg.subject}\n\n${text}`) });
    }
    for (const c of channels) {
      let state: "sent" | "failed" | "not_configured" = "not_configured";
      let error: string | null = null;
      if (c.ok) {
        try {
          await c.send();
          state = "sent";
        } catch (e) {
          state = "failed";
          error = (e as Error).message?.slice(0, 500) ?? "error";
          console.error(`notify ${c.channel} to ${r.username}:`, error);
        }
      } else if (process.env.NODE_ENV !== "production") {
        // Local development without a provider: show what would have been sent.
        console.log(`[notify:${c.channel} not configured] to ${r.username} <${c.to}>\n${subject}\n${text}\n`);
      }
      status[c.channel] = state === "sent" ? "sent" : "failed";
      await db.insert(notifications).values({ userId: r.id, channel: c.channel, recipient: c.to, kind: msg.kind, subject, body: logged, status: state, error });
    }
  }
  return result;
}

/** Sends after the response is out, so the person who clicked doesn't wait for email/Telegram. */
export function deliverLater(userIds: () => Promise<string[]>, compose: Compose) {
  after(async () => {
    try {
      await deliver(await userIds(), compose);
    } catch (e) {
      console.error("notify failed:", e);
    }
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function emailHtml(lines: string[], link: string | null, label: string) {
  const body = lines.map((l) => (l ? `<p style="margin:0 0 8px">${escapeHtml(l)}</p>` : "<br>")).join("");
  const button = link
    ? `<p style="margin:20px 0"><a href="${escapeHtml(link)}" style="background:#2563eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p><p style="color:#6b7280;font-size:12px">${escapeHtml(link)}</p>`
    : "";
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111827;max-width:560px">${body}${button}</div>`;
}
