import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
config({ path: ".env.local" });

// Local only: saves the local database (e.g. the data entered by the owner) as the demo snapshot.
// `npm run db:reset` then restores it instead of the built-in example. Stop `npm run dev` first.
async function main() {
  if (process.env.DATABASE_URL) throw new Error("DATABASE_URL is set – this only works with the local database.");
  const dir = process.env.PGLITE_DIR || "./.pglite";
  const { claimLocalDb } = await import("../src/db/local-lock");
  claimLocalDb(dir);
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(dir);
  const file = await db.dumpDataDir("gzip");
  await db.close();
  const out = path.join("demo", "demo-db.tar.gz");
  fs.mkdirSync("demo", { recursive: true });
  fs.writeFileSync(out, Buffer.from(await file.arrayBuffer()));
  console.log(`Saved ${out} (${Math.round(fs.statSync(out).size / 1024)} KB). "npm run db:reset" now restores it.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
