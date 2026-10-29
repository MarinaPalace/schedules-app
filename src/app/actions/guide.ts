"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withActor } from "@/lib/actor";
import { assertRole, getCurrentUser } from "@/lib/session";
import { setSetting } from "@/lib/settings";

// Remembered per user (or for the hotel): which guidance was already seen.

export async function hideChecklist(): Promise<{ ok?: string; error?: string }> {
  const me = await getCurrentUser();
  if (!me) return { error: "notSignedIn" };
  await withActor(me.id, (tx) => setSetting(tx, `checklist_hidden:${me.id}`, "1"));
  revalidatePath("/dashboard");
  return { ok: "ok" };
}

export async function showChecklist(): Promise<{ ok?: string; error?: string }> {
  const me = await getCurrentUser();
  if (!me) return { error: "notSignedIn" };
  await withActor(me.id, (tx) => setSetting(tx, `checklist_hidden:${me.id}`, "0"));
  revalidatePath("/dashboard");
  return { ok: "ok" };
}

export async function markIntroSeen(): Promise<{ ok?: string; error?: string }> {
  const me = await getCurrentUser();
  if (!me) return { error: "notSignedIn" };
  await withActor(me.id, (tx) => setSetting(tx, `intro_seen:${me.id}`, "1"));
  revalidatePath("/", "layout");
  return { ok: "ok" };
}

/** Last step of the owner's welcome wizard: from now on the checklist guides. */
export async function finishWelcome() {
  const me = await assertRole(["owner", "admin"]);
  await withActor(me.id, (tx) => setSetting(tx, "welcome_done", "1"));
  redirect("/dashboard");
}
