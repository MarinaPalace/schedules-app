"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { user } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import { telegramConnect } from "@/lib/account-links";
import { errorMessage } from "@/lib/errors";
import type { LinkResult } from "@/lib/link-result";
import { deliver } from "@/lib/notify/deliver";
import { getCurrentUser } from "@/lib/session";

async function me() {
  const u = await getCurrentUser();
  if (!u) throw new AppError("notSignedIn");
  return u;
}

export async function updateMyNotifications(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const u = await me();
    const email = String(form.get("email") ?? "").trim();
    const contactEmail = email ? z.email("emailFormat").max(200).parse(email) : null;
    await withActor(u.id, (tx) =>
      tx
        .update(user)
        .set({ contactEmail, notifyEmail: form.get("notifyEmail") === "on", notifyTelegram: form.get("notifyTelegram") === "on", updatedAt: new Date() })
        .where(eq(user.id, u.id)),
    );
    revalidatePath("/account");
  });
}

/** Link that opens the bot; pressing Start connects this login to the chat. */
export async function connectMyTelegram(): Promise<LinkResult> {
  try {
    const u = await me();
    const res = await telegramConnect(u.id, u.id);
    if (!res.telegramLink) throw new AppError("telegramNotConfigured");
    return { ...res, ok: "ok", at: Date.now() };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}

export async function disconnectMyTelegram(): Promise<{ error?: string; ok?: string }> {
  try {
    const u = await me();
    await withActor(u.id, (tx) => tx.update(user).set({ telegramChatId: null, telegramName: null, updatedAt: new Date() }).where(eq(user.id, u.id)));
    revalidatePath("/account");
    return { ok: "ok" };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}

/** Sends a test message to every channel the user has, and says what happened. */
export async function sendMeTest(): Promise<{ error?: string; ok?: string }> {
  try {
    const u = await me();
    const res = (await deliver([u.id], (t) => ({ kind: "test", subject: t("notify.test.subject"), lines: [t("notify.test.text")], link: "/account" }), { force: true })).get(u.id);
    const t = await getTranslations("account");
    if (!res || (res.email === "none" && res.telegram === "none")) throw new AppError("noChannels");
    return { ok: t("testResult", { email: res.email, telegram: res.telegram }) };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}
