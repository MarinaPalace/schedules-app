/** Public address of the app, used in links inside emails and Telegram messages. */
export function appUrl(path = ""): string {
  const base = (process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path}`;
}
