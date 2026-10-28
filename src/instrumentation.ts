// Runs once when the server starts.
export async function register() {
  // With the local embedded database, apply pending migrations automatically so the
  // running app always matches the code. Real databases are migrated explicitly (npm run db:migrate).
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.DATABASE_URL) {
    const { db } = await import("./db/client");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "./drizzle" });
  }
}
