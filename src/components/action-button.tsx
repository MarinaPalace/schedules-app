"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Result = { error?: string; ok?: string };

/** One-tap server action (e.g. "Mark as given", "Accept"); shows the error under the button. */
export function ActionButton<A extends unknown[]>({
  action,
  args,
  children,
  className = "btn btn-sm",
  confirm,
  showOk,
}: {
  action: (...args: A) => Promise<Result>;
  args: A;
  children: ReactNode;
  className?: string;
  confirm?: string;
  /** Show the action's success message under the button. */
  showOk?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const res = await action(...args);
            setError(res.error ?? null);
            setOk(res.error ? null : (res.ok ?? null));
            if (!res.error) router.refresh();
          });
        }}
      >
        {pending ? "…" : children}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
      {showOk && ok && <span className="text-xs text-green-700">{ok}</span>}
    </span>
  );
}
