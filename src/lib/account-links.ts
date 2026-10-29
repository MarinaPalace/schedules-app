import "server-only";
import QRCode from "qrcode";
import { withActor } from "@/lib/actor";
import { appUrl } from "@/lib/app-url";
import type { LinkResult } from "@/lib/link-result";
import { issueLink } from "@/lib/login-links";
import { telegramBot } from "@/lib/notify/channels";
import { deliver } from "@/lib/notify/deliver";

const qr = (text: string) => QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" });

/**
 * Creates a fresh "choose your password" link (`setup` for new accounts, `reset` otherwise),
 * sends it by email/Telegram if the person has them, and returns it for handing over in person.
 */
export async function sendPasswordLink(actorId: string, userId: string, purpose: "setup" | "reset", opts: { telegramLink?: boolean } = { telegramLink: true }): Promise<LinkResult> {
  const token = await withActor(actorId, (tx) => issueLink(tx, userId, purpose, actorId));
  const link = appUrl(`/set-password?token=${token}`);
  const sent = await deliver(
    [userId],
    (t, r) => ({
      kind: `account.${purpose}`,
      subject: t(`notify.account.${purpose}.subject`),
      lines: t(`notify.account.${purpose}.text`, { name: r.name, username: r.username ?? "" }).split("\n"),
      link,
      linkLabel: t(`notify.account.${purpose}.button`),
      secretLink: true,
    }),
    { force: true },
  );
  const d = sent.get(userId) ?? { email: "none", telegram: "none" };
  return { link, qr: await qr(link), email: d.email, telegram: d.telegram, ...(opts.telegramLink ? await telegramConnect(actorId, userId) : {}) };
}

/** Link that connects the person's Telegram chat to their login (null if no bot is set up). */
export async function telegramConnect(actorId: string, userId: string): Promise<Pick<LinkResult, "telegramLink" | "telegramQr">> {
  const bot = telegramBot();
  if (!bot) return {};
  const token = await withActor(actorId, (tx) => issueLink(tx, userId, "telegram", actorId));
  const telegramLink = `https://t.me/${bot}?start=${token}`;
  return { telegramLink, telegramQr: await qr(telegramLink) };
}

/** Security notice after a password change (always sent, whatever the person's switches). */
export async function sendPasswordChanged(userId: string) {
  await deliver([userId], (t) => ({ kind: "account.passwordChanged", subject: t("notify.account.passwordChanged.subject"), lines: [t("notify.account.passwordChanged.text")] }), {
    force: true,
  });
}

/** Links for a printed invite slip: a fresh setup link and the Telegram connect link (nothing is sent). */
export async function printableLinks(actorId: string, userId: string) {
  const token = await withActor(actorId, (tx) => issueLink(tx, userId, "setup", actorId));
  return { link: appUrl(`/set-password?token=${token}`), ...(await telegramConnect(actorId, userId)) };
}
