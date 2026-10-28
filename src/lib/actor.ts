import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs writes in a transaction tagged with the acting user, so the audit
 * trigger records who did it. All business writes must go through this.
 */
export async function withActor<T>(actorId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.actor_id', ${actorId}, true)`);
    return fn(tx);
  });
}
