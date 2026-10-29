import "server-only";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, loginTokens } from "@/db/schema";

/** invited = setup link still open · active = has logged in at least once · expired = never logged in, no open link. */
export type LoginStatus = "invited" | "active" | "expired";

export async function loginStatuses(userIds: string[]): Promise<Map<string, LoginStatus>> {
  const result = new Map<string, LoginStatus>();
  if (!userIds.length) return result;
  const [open, seen] = await Promise.all([
    db
      .selectDistinct({ userId: loginTokens.userId })
      .from(loginTokens)
      .where(and(inArray(loginTokens.userId, userIds), eq(loginTokens.purpose, "setup"), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date()))),
    // Every sign-in creates a session row, and the audit trail keeps them all (sessions themselves expire).
    db
      .selectDistinct({ userId: sql<string>`${auditEvents.newData}->>'user_id'` })
      .from(auditEvents)
      .where(and(eq(auditEvents.tableName, "session"), inArray(sql`${auditEvents.newData}->>'user_id'`, userIds))),
  ]);
  const openSet = new Set(open.map((r) => r.userId));
  const seenSet = new Set(seen.map((r) => r.userId));
  for (const id of userIds) result.set(id, openSet.has(id) ? "invited" : seenSet.has(id) ? "active" : "expired");
  return result;
}
