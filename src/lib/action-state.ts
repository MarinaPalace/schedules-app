export type ActionState = { error?: string; ok?: string; at?: number };

/** Wraps a server action body: thrown errors become a message for the form. */
export async function run(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const ok = await fn();
    return { ok: ok || "Saved", at: Date.now() };
  } catch (e) {
    const err = e as { cause?: { message?: string; code?: string }; message?: string; issues?: { message: string }[] };
    if (err.cause?.code === "23505") return { error: "This already exists (name, code or number must be unique)", at: Date.now() };
    // zod validation errors
    if (err.issues?.length) return { error: err.issues.map((i) => i.message).join("; "), at: Date.now() };
    return { error: err.cause?.message ?? err.message ?? "Something went wrong", at: Date.now() };
  }
}
