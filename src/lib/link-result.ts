/** What an admin sees after sending a login link: how it was delivered, plus the link/QR to hand over in person. */
export type LinkResult = {
  error?: string;
  ok?: string;
  at?: number;
  link?: string;
  qr?: string;
  email?: "sent" | "failed" | "none";
  telegram?: "sent" | "failed" | "none";
  /** t.me link that connects the person's Telegram (and then sends them the link there). */
  telegramLink?: string;
  telegramQr?: string;
};
