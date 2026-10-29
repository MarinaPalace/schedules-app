import { timingSafeEqual } from "node:crypto";
import { telegramConfigured } from "@/lib/notify/channels";
import { handleTelegramUpdate, type TelegramUpdate } from "@/lib/notify/telegram-bot";

/** Telegram calls this for every message to the bot. The secret header proves the call comes from Telegram. */
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const ok = secret.length > 0 && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
  if (!telegramConfigured() || !ok) return new Response("Forbidden", { status: 403 });
  try {
    await handleTelegramUpdate((await request.json()) as TelegramUpdate);
  } catch (e) {
    // Answer 200 anyway, or Telegram keeps re-sending the same update.
    console.error("telegram update failed:", e);
  }
  return Response.json({ ok: true });
}
