import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

// Email over SMTP (any provider: SMTP_URL=smtps://user:pass@smtp.example.com:465) and the Telegram Bot API.

export const emailConfigured = () => !!process.env.SMTP_URL;
export const telegramConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN;
export const telegramBot = () => process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || null;
export const mailFrom = () => process.env.MAIL_FROM || "Hotel Schedules <no-reply@localhost>";

const globalForMail = globalThis as unknown as { __mail?: Transporter };

export async function sendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  globalForMail.__mail ??= nodemailer.createTransport({ url: process.env.SMTP_URL!, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000 });
  await globalForMail.__mail.sendMail({ from: mailFrom(), to, subject, text, html });
}

/** Calls a Bot API method; throws with Telegram's description on failure. */
export async function telegramApi<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  // TELEGRAM_API_BASE lets tests point at a fake server.
  const base = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
  const res = await fetch(`${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!data?.ok) throw new Error(data?.description || `Telegram ${method}: HTTP ${res.status}`);
  return data.result as T;
}

export async function sendTelegram(chatId: string, text: string): Promise<void> {
  await telegramApi("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
}
