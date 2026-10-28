import { config } from "dotenv";
import fs from "node:fs";
import { execSync } from "node:child_process";
config({ path: ".env.local" });

// Local development only: wipe the embedded database and rebuild it with demo data.
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
execSync("npm run db:migrate", { stdio: "inherit" });
execSync("npm run db:seed", { stdio: "inherit" });
