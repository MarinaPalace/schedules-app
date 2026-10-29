import { config } from "dotenv";
config({ path: ".env.local" });

// Sanity checks for the "no deletions / full history" guarantees.
async function main() {
  const { db } = await import("../src/db/client");
  const { sql } = await import("drizzle-orm");

  let failures = 0;
  const expectError = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      console.log(`FAIL  ${label}: expected an error`);
      failures++;
    } catch (e) {
      const err = e as { cause?: { message?: string }; message?: string };
      console.log(`ok    ${label}: ${err.cause?.message ?? err.message}`);
    }
  };
  const rows = async (q: ReturnType<typeof sql>) =>
    ((await db.execute(q)) as unknown as { rows: Record<string, unknown>[] }).rows;

  await expectError("delete department blocked", () => db.execute(sql`delete from departments`));
  await expectError("delete user blocked", () => db.execute(sql`delete from "user"`));
  await expectError("truncate employees blocked", () => db.execute(sql`truncate employees cascade`));
  await expectError("update rate history blocked", () => db.execute(sql`update employee_rates set hourly_rate_cents = 1`));
  await expectError("update audit log blocked", () => db.execute(sql`update audit_events set actor_id = 'x'`));
  // Row triggers only fire when a row matches, so these need some swaps/payments in the database.
  const has = async (table: string) => Number((await rows(sql.raw(`select count(*)::int as n from ${table}`)))[0].n) > 0;
  if (await has("swap_events")) {
    await expectError("delete swap request blocked", () => db.execute(sql`delete from swap_requests`));
    await expectError("update swap event blocked", () => db.execute(sql`update swap_events set action = 'approved'`));
  } else console.log("skip  swap checks (no swaps yet)");
  if (await has("swap_events where action in ('declined','cancelled','approved','rejected')")) {
    await expectError("second final swap event blocked", () =>
      db.execute(sql`insert into swap_events (request_id, action) select request_id, 'approved' from swap_events where action in ('declined','cancelled','approved','rejected') limit 1`),
    );
  }
  if (await has("login_tokens where used_at is not null")) {
    await expectError("re-opening a used login link blocked", () => db.execute(sql`update login_tokens set used_at = null where used_at is not null`));
    await expectError("delete login link blocked", () => db.execute(sql`delete from login_tokens`));
  } else console.log("skip  login link checks (none used yet)");
  if (await has("notifications")) {
    await expectError("edit notification log blocked", () => db.execute(sql`update notifications set body = 'x'`));
  }
  if (await has("advance_payments")) {
    await expectError("update advance payment blocked", () => db.execute(sql`update advance_payments set note = 'x'`));
  } else console.log("skip  advance payment check (none yet)");

  const [{ n }] = await rows(sql`select count(*)::int as n from audit_events`);
  const [{ broken }] = await rows(sql`select app_verify_audit_chain() as broken`);
  console.log(`audit events: ${n}, chain ${broken === null ? "intact" : `BROKEN at id ${broken}`}`);
  if (broken !== null || Number(n) === 0) failures++;

  const leaked = await rows(sql`select id from audit_events where new_data ? 'password' or new_data ? 'token' limit 1`);
  if (leaked.length) {
    console.log("FAIL  secrets found in audit log");
    failures++;
  } else console.log("ok    no passwords/tokens in audit log");

  // Tamper with a row while bypassing triggers (only a DB superuser can), then roll back.
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update audit_events set new_data = '{"tampered":true}' where id = (select min(id) + 1 from audit_events)`);
      const r = (await tx.execute(sql`select app_verify_audit_chain() as broken`)) as unknown as { rows: { broken: unknown }[] };
      const at = r.rows[0].broken;
      console.log(at === null ? "FAIL  tampering not detected" : `ok    tampering detected at id ${at}`);
      if (at === null) failures++;
      throw new Error("rollback");
    });
  } catch (e) {
    if ((e as Error).message !== "rollback") throw e;
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
