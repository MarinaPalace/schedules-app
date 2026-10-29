import { config } from "dotenv";
config({ path: ".env.local" });

// Local development: Telegram can't reach localhost, so fetch the bot's messages and
// hand them to the app's webhook. Run next to `npm run dev`. Not needed in production.
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const app = (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
  if (!token || !secret) throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env.local");
  const api = `${(process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "")}/bot${token}`;

  // getUpdates doesn't work while a webhook is set.
  await fetch(`${api}/deleteWebhook`, { method: "POST" });
  console.log(`Forwarding Telegram messages to ${app}/api/telegram/webhook (Ctrl+C to stop)`);
  let offset = 0;
  for (;;) {
    try {
      const res = await fetch(`${api}/getUpdates?timeout=25&offset=${offset}`);
      const data = (await res.json()) as { ok: boolean; result: { update_id: number }[]; description?: string };
      if (!data.ok) throw new Error(data.description);
      for (const update of data.result) {
        offset = update.update_id + 1;
        const r = await fetch(`${app}/api/telegram/webhook`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
          body: JSON.stringify(update),
        });
        console.log(`update ${update.update_id} → ${r.status}`);
      }
    } catch (e) {
      console.error((e as Error).message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();
