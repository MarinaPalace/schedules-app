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
| `npm run db:check` | Verify no-delete / no-update rules and the audit hash chain |
| `npm test` | Unit tests for hour and cost calculations |

With PGlite, stop the dev server before running `db:*` scripts (one process at a time).
