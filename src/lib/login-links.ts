import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { loginTokens, user } from "@/db/schema";
import type { Tx } from "@/lib/actor";
import { AppError } from "@/lib/app-error";

/** setup = choose the first password, reset = forgotten password, telegram = connect a Telegram chat. */
export type LinkPurpose = "setup" | "reset" | "telegram";

const HOUR = 60 * 60 * 1000;
const LIFETIME: Record<LinkPurpose, number> = { setup: 7 * 24 * HOUR, reset: 2 * HOUR, telegram: 30 * 24 * HOUR };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * New single-use link for a user. Earlier unused links of the same kind stop working
 * (they are marked used), so only the newest one sent is valid.
 */
export async function issueLink(tx: Tx, userId: string, purpose: LinkPurpose, createdBy: string | null): Promise<string> {
  const now = new Date();
  await tx
    .update(loginTokens)
    .set({ usedAt: now })
    .where(and(eq(loginTokens.userId, userId), eq(loginTokens.purpose, purpose), isNull(loginTokens.usedAt)));
  const token = randomBytes(24).toString("base64url");
  await tx.insert(loginTokens).values({ userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + LIFETIME[purpose]), createdBy });
  return token;
}

/** The link and its (active) user, if the token is valid for one of `purposes`. */
export async function findLink(token: string, purposes: LinkPurpose[]) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const [row] = await db
    .select({ link: loginTokens, user })
    .from(loginTokens)
    .innerJoin(user, eq(user.id, loginTokens.userId))
    .where(and(eq(loginTokens.tokenHash, hashToken(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
    .limit(1);
  if (!row || !purposes.includes(row.link.purpose as LinkPurpose) || !row.user.active) return null;
  return row;
}

/** Marks a link as used; fails if someone used it in the meantime. */
export async function useLink(tx: Tx, linkId: string) {
  const done = await tx
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.id, linkId), isNull(loginTokens.usedAt)))
    .returning({ id: loginTokens.id });
  if (!done.length) throw new AppError("linkInvalid");
}

/** True if the user was invited but hasn't chosen a password yet (an open setup link exists). */
export async function hasOpenSetup(userId: string) {
  const [row] = await db
    .select({ id: loginTokens.id })
    .from(loginTokens)
    .where(and(eq(loginTokens.userId, userId), eq(loginTokens.purpose, "setup"), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
    .limit(1);
  return !!row;
}
