import fs from "node:fs";
import path from "node:path";
import { db } from "./client";

const globalForMigrate = globalThis as unknown as { __migratedTag?: string; __migrating?: Promise<void> };

/**
 * Local embedded database only: applies migrations that appeared while `npm run dev`
 * was running (hot reload keeps the process alive, so startup hooks don't run again).
 * Cheap after the first call: it only compares the newest migration name.
 */
export async function ensureLocalSchema(): Promise<void> {
  if (process.env.DATABASE_URL) return;
  const folder = path.join(process.cwd(), "drizzle");
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const latest = journal.entries.at(-1)?.tag ?? "";
  if (globalForMigrate.__migratedTag === latest) return;
  globalForMigrate.__migrating ??= (async () => {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: folder });
    globalForMigrate.__migratedTag = latest;
  })().finally(() => {
    globalForMigrate.__migrating = undefined;
  });
  await globalForMigrate.__migrating;
}
