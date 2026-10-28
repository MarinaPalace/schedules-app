import fs from "node:fs";

/**
 * PGlite keeps the database in the memory of the process that opened it, so two
 * processes (e.g. `npm run dev` and `npm run db:seed`) must never use it at once.
 * A small lock file next to the data folder enforces that with a clear message.
 */
export function claimLocalDb(dir: string): void {
  const lockFile = `${dir.replace(/[\\/]+$/, "")}.lock`;
  try {
    const pid = Number(fs.readFileSync(lockFile, "utf8"));
    if (pid && pid !== process.pid && isAlive(pid)) {
      throw new Error(
        `The local database (${dir}) is open in another process (pid ${pid}, probably "npm run dev"). ` +
          `Stop that process first, then run this again.`,
      );
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  fs.writeFileSync(lockFile, String(process.pid));
  process.on("exit", () => {
    try {
      if (fs.readFileSync(lockFile, "utf8") === String(process.pid)) fs.unlinkSync(lockFile);
    } catch {
      // already gone
    }
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
