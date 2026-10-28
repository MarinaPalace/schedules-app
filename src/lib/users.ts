import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { account, user } from "@/db/schema";
import type { Tx } from "@/lib/actor";
import type { Role } from "@/lib/session";
import { AppError } from "@/lib/app-error";

export const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

export function normalizeUsername(u: string): string {
  return u.trim().toLowerCase();
}

/** Staff may have no email; Better Auth needs one, so we store an internal placeholder. */
function placeholderEmail(username: string): string {
  return `${username}@staff.local`;
}

export async function createLogin(
  tx: Tx,
  input: { username: string; name: string; password: string; role: Role },
): Promise<string> {
  const username = normalizeUsername(input.username);
  if (!USERNAME_RE.test(username)) {
    throw new AppError("usernameFormat");
  }
  if (input.password.length < 6) throw new AppError("passwordShort");
  const existing = await tx.query.user.findFirst({ where: eq(user.username, username) });
  if (existing) throw new AppError("usernameTaken", { username });

  const id = crypto.randomUUID();
  await tx.insert(user).values({
    id,
    name: input.name,
    email: placeholderEmail(username),
    username,
    displayUsername: username,
    role: input.role,
  });
  await tx.insert(account).values({
    id: crypto.randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(input.password),
  });
  return id;
}

export async function setPassword(tx: Tx, userId: string, password: string): Promise<void> {
  if (password.length < 6) throw new AppError("passwordShort");
  await tx
    .update(account)
    .set({ password: await hashPassword(password), updatedAt: new Date() })
    .where(eq(account.userId, userId));
}
