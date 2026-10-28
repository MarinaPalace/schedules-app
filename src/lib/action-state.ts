import "server-only";
import { getTranslations } from "next-intl/server";
import { errorMessage } from "@/lib/errors";

export type ActionState = { error?: string; ok?: string; at?: number };

/** Wraps a server action body: thrown errors become a translated message for the form. */
export async function run(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const ok = await fn();
    return { ok: ok || (await getTranslations("common"))("saved"), at: Date.now() };
  } catch (e) {
    return { error: await errorMessage(e), at: Date.now() };
  }
}
