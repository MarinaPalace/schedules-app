import "server-only";
import { eq } from "drizzle-orm";
import { user } from "@/db/schema";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { withActor } from "@/lib/actor";
import { appUrl } from "@/lib/app-url";
import { sendPasswordLink } from "@/lib/account-links";
import { findLink, hasOpenSetup, useLink } from "@/lib/login-links";
import { sendTelegram } from "@/lib/notify/channels";
import { translatorFor } from "@/lib/notify/deliver";

export type TelegramUpdate = {
  update_id: number;
  message?: { chat: { id: number; type: string }; from?: { username?: string; first_name?: string; language_code?: string }; text?: string };
};

/**
 * Handles one update from Telegram (webhook in production, `npm run telegram:poll` locally).
 * "/start <token>" connects the chat to the login the token was made for.
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text || msg.chat.type !== "private") return;
  const chatId = String(msg.chat.id);
  const lang = msg.from?.language_code?.slice(0, 2);
  const guess = translatorFor(isLocale(lang) ? lang : DEFAULT_LOCALE);
  const [command, token] = msg.text.trim().split(/\s+/, 2);

  if (command !== "/start" || !token) {
    await sendTelegram(chatId, `${guess("notify.bot.help")}\n\n${appUrl("/account")}`);
    return;
  }
  const found = await findLink(token, ["telegram"]);
  if (!found) {
    await sendTelegram(chatId, guess("notify.bot.badLink"));
    return;
  }
  const u = found.user;
  const name = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? null);
  await withActor(u.id, async (tx) => {
    await useLink(tx, found.link.id);
    // One chat belongs to one login: move it if it was connected to someone else before.
    await tx.update(user).set({ telegramChatId: null, telegramName: null }).where(eq(user.telegramChatId, chatId));
    await tx.update(user).set({ telegramChatId: chatId, telegramName: name, updatedAt: new Date() }).where(eq(user.id, u.id));
  });
  const t = translatorFor(isLocale(u.locale) ? u.locale : DEFAULT_LOCALE);
  await sendTelegram(chatId, t("notify.bot.connected", { name: u.name }));
  // Invited but no password yet: send the setup link here (a new one – it replaces any earlier link).
  if (await hasOpenSetup(u.id)) await sendPasswordLink(u.id, u.id, "setup", { telegramLink: false });
}
