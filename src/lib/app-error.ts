import type en from "../../messages/en.json";

export type ErrorKey = keyof (typeof en)["errors"];

/** An expected, user-facing error. `key` is translated in the user's language when shown. */
export class AppError extends Error {
  constructor(
    public key: ErrorKey,
    public values?: Record<string, string | number>,
  ) {
    super(key);
  }
}
