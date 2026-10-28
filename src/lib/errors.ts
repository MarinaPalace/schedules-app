import "server-only";
import { getTranslations } from "next-intl/server";
import { AppError, type ErrorKey } from "@/lib/app-error";

/**
 * Turns any thrown error into a message in the user's language.
 * AppError keys and zod messages (which are error keys) are translated.
 */
export async function errorMessage(e: unknown): Promise<string> {
  const t = await getTranslations("errors");
  if (e instanceof AppError) return t(e.key, e.values);
  const err = e as { cause?: { code?: string; message?: string }; message?: string; issues?: { message: string }[] };
  if (err.cause?.code === "23505") return t("alreadyExists");
  const text = err.issues?.[0]?.message ?? err.message;
  if (text && t.has(text as ErrorKey)) return t(text as ErrorKey);
  console.error(e);
  return err.cause?.message ?? text ?? t("generic");
}
