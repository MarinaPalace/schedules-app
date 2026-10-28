import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

// Any Postgres (Neon, Supabase…) when DATABASE_URL is set; embedded PGlite for local development.
function createDb(): DB {
  const url = process.env.DATABASE_URL;
  if (url) {
    return drizzlePg({ client: new Pool({ connectionString: url, max: 5 }), schema }) as unknown as DB;
  }
  const client = new PGlite(process.env.PGLITE_DIR || "./.pglite");
  return drizzlePglite({ client, schema }) as unknown as DB;
}

// Opened on first use (not on import), and reused across hot reloads in dev.
const globalForDb = globalThis as unknown as { __db?: DB };
function getDb(): DB {
  globalForDb.__db ??= createDb();
  return globalForDb.__db;
}

export const db = new Proxy({} as DB, {
  get(_, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
