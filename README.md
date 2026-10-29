# Hotel Schedules

Schedules, Forma 76 and labour-budget tracking for the hotel.

- **Plan, phases and progress:** see [PLAN.md](PLAN.md)
- **Stack:** Next.js 16 · Drizzle · Postgres – Neon or Supabase (PGlite locally) · Better Auth (username login)

## Quick start

```bash
npm install
cp .env.example .env.local    # set BETTER_AUTH_SECRET; leave DATABASE_URL empty for local PGlite
npm run db:migrate
npm run db:seed               # demo users, password demo1234
npm run dev
```

| Script | What it does |
|---|---|
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Demo data (only on an empty database) |
| `npm run db:reset` | Local only: wipe and rebuild the demo database |
| `npm run db:check` | Verify no-delete / no-update rules and the audit hash chain |
| `npm test` | Unit tests (hours, costs, swaps, PDF, translations) |
| `npm run telegram:poll` | Local only: pass Telegram bot messages to the dev server (Telegram can't reach localhost) |

Languages: Bulgarian (default), English, Russian – texts live in `messages/*.json`.

With the local database, stop the dev server before running `db:*` scripts (they refuse otherwise). `npm run dev` applies new migrations automatically.

## Logins, email and Telegram

Nobody types or sends passwords. Creating a login (or "Send password reset link") makes a **one-time link**:
the person opens it, sees their username and chooses their own password (min. 8 characters). Invite links last 7 days,
reset links 2 hours. Staff can also use **Forgot password?** on the sign-in page. The link goes out by email and/or
Telegram if the person has them; the admin always also gets the link + QR code to hand over in person.

Notifications (swaps, published schedules, advances, Forma 76 corrections, password changes) go to every channel a
person has; each person can switch email/Telegram off under **My account**. Messages are in the language the person
uses the app in. **Admin → Notifications** shows the set-up status and a log (login links are never stored).

**Email:** set `SMTP_URL` and `MAIL_FROM` (see `.env.example`).

**Telegram:**
1. In Telegram, talk to **@BotFather** → `/newbot` → copy the token.
2. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (without @), a random `TELEGRAM_WEBHOOK_SECRET`, and `APP_URL` (the public https address).
3. Deploy, then **Admin → Notifications → Connect bot to this app**.
4. A bot can't write to someone first: each person opens the bot once – from **My account → Connect Telegram**, or by scanning
   the Telegram QR the admin sees after creating their login. A person invited this way gets their password link in Telegram.

Locally, run `npm run telegram:poll` next to `npm run dev` instead of step 3.
