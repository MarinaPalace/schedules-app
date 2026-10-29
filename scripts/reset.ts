import { config } from "dotenv";
import fs from "node:fs";
import { execSync } from "node:child_process";
config({ path: ".env.local" });

// Local development only: wipe the embedded database and rebuild it – from the saved demo snapshot
// if there is one, else the built-in example (`--builtin`), or empty with only the admin login (`--empty`).
if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL is set – refusing to reset a real database.");
  process.exit(1);
}
const dir = process.env.PGLITE_DIR || "./.pglite";
const lock = `${dir.replace(/[\/]+$/, "")}.lock`;
if (fs.existsSync(lock)) {
  const pid = Number(fs.readFileSync(lock, "utf8"));
  try {
    process.kill(pid, 0);
    console.error(`The local database is open in another process (pid ${pid}, probably "npm run dev"). Stop it first.`);
    process.exit(1);
  } catch {
    // stale lock
  }
}
fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(lock, { force: true });

// A saved demo snapshot (npm run db:save-demo) wins over the built-in example, unless --builtin / --empty.
const snapshot = "demo/demo-db.tar.gz";
const useSnapshot = fs.existsSync(snapshot) && !process.argv.includes("--builtin") && !process.argv.includes("--empty");

async function main() {
  if (useSnapshot) {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(dir, { loadDataDir: new Blob([fs.readFileSync(snapshot)]) });
    await db.waitReady;
    await db.close();
    console.log(`Restored ${snapshot}.`);
    execSync("npm run db:migrate", { stdio: "inherit" }); // newer migrations on top of the snapshot
    return;
  }
  execSync("npm run db:migrate", { stdio: "inherit" });
  execSync(process.argv.includes("--empty") ? "npm run db:seed -- --admin-only" : "npm run db:seed", { stdio: "inherit" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
