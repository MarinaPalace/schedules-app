// Runs once when the server starts.
export async function register() {
  // With the local embedded database, apply pending migrations right away so the
  // running app always matches the code (src/db/local-migrate.ts also re-checks on each
  // request during development). Real databases are migrated explicitly (npm run db:migrate).
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.DATABASE_URL) {
    const { ensureLocalSchema } = await import("./db/local-migrate");
    await ensureLocalSchema();
  }
}
