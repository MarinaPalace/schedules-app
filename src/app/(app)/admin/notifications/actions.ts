"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/app-error";
import { appUrl } from "@/lib/app-url";
import { errorMessage } from "@/lib/errors";
import { telegramApi, telegramConfigured } from "@/lib/notify/channels";
import { assertRole } from "@/lib/session";

/** Tells Telegram where to deliver messages to the bot (run once after deploying, or when the address changes). */
export async function connectTelegramWebhook(): Promise<{ error?: string; ok?: string }> {
  try {
    await assertRole(["admin", "owner"]);
    if (!telegramConfigured() || !process.env.TELEGRAM_WEBHOOK_SECRET) throw new AppError("telegramNotConfigured");
    const url = appUrl("/api/telegram/webhook");
    if (!url.startsWith("https://")) throw new AppError("webhookNeedsHttps");
    await telegramApi("setWebhook", { url, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"], drop_pending_updates: false });
    revalidatePath("/admin/notifications");
    return { ok: "ok" };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}
