"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { and, eq, gt, ne, count } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import { db } from "@/db/client";
import { account, loginTokens, session, user } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import { auth } from "@/lib/auth";
import { sendPasswordChanged, sendPasswordLink } from "@/lib/account-links";
import { findLink, useLink } from "@/lib/login-links";
import { getCurrentUser } from "@/lib/session";
import { normalizeUsername, setPassword } from "@/lib/users";

function newPasswordFrom(form: FormData) {
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("repeat") ?? "")) throw new AppError("passwordsDiffer");
  return password;
}

/** From an invite or reset link: choose a password, end other sessions, sign in. */
export async function setPasswordWithLink(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await run(async () => {
    const token = String(form.get("token") ?? "");
    const password = newPasswordFrom(form);
    const found = await findLink(token, ["setup", "reset"]);
    if (!found) throw new AppError("linkInvalid");
    const { link, user: u } = found;
    await withActor(u.id, async (tx) => {
      await useLink(tx, link.id);
      await setPassword(tx, u.id, password);
      // A reset logs out every device that might have the old password.
      await tx.delete(session).where(eq(session.userId, u.id));
    });
    await auth.api.signInUsername({ body: { username: u.username!, password }, headers: await headers() });
    if (link.purpose === "reset") after(() => sendPasswordChanged(u.id));
  });
  if (res.error) return res;
  redirect("/");
}

/** "Forgot password": sends a link to the person's email/Telegram. Same answer whether or not the account exists. */
export async function requestPasswordReset(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const username = normalizeUsername(String(form.get("username") ?? ""));
    const t = await getTranslations("forgot");
    if (!username) throw new AppError("usernameFormat");
    const u = await db.query.user.findFirst({ where: eq(user.username, username) });
    if (u?.active && (u.contactEmail || u.telegramChatId)) {
      // At most 3 links per hour per account.
      const [{ n }] = await db
        .select({ n: count() })
        .from(loginTokens)
        .where(and(eq(loginTokens.userId, u.id), eq(loginTokens.purpose, "reset"), gt(loginTokens.createdAt, new Date(Date.now() - 60 * 60 * 1000))));
      if (n < 3) await sendPasswordLink(u.id, u.id, "reset", { telegramLink: false });
    }
    return t("sentIfPossible");
  });
}

/** Signed in: change the password with the current one; other devices are signed out. */
export async function changePassword(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await getCurrentUser();
    if (!me) throw new AppError("notSignedIn");
    const password = newPasswordFrom(form);
    const cred = await db.query.account.findFirst({ where: and(eq(account.userId, me.id), eq(account.providerId, "credential")) });
    if (!cred?.password || !(await verifyPassword({ hash: cred.password, password: String(form.get("current") ?? "") }))) throw new AppError("currentPasswordWrong");
    const current = await auth.api.getSession({ headers: await headers() });
    await withActor(me.id, async (tx) => {
      await setPassword(tx, me.id, password);
      if (current) await tx.delete(session).where(and(eq(session.userId, me.id), ne(session.id, current.session.id)));
    });
    after(() => sendPasswordChanged(me.id));
    return (await getTranslations("account"))("passwordChanged");
  });
}
