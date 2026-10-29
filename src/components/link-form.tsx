"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { LinkResult } from "@/lib/link-result";

/** Form whose action sends a login link; shows how it was delivered and the link/QR to hand over in person. */
export function LinkForm({
  action,
  children,
  className,
  resetOnSuccess,
  replaceOnSuccess,
}: {
  action: (prev: LinkResult, form: FormData) => Promise<LinkResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** Show only the result (with a Done button that reloads the page) – for actions that change what the page shows. */
  replaceOnSuccess?: boolean;
}) {
  const t = useTranslations("links");
  const router = useRouter();
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  if (replaceOnSuccess && state.ok && !state.error) {
    return (
      <div className="space-y-3">
        <LinkPanel key={state.at} r={state} />
        <button type="button" className="btn" onClick={() => router.refresh()}>
          {t("done")}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <form ref={ref} action={formAction} className={className}>
        {children}
      </form>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && !state.error && <LinkPanel key={state.at} r={state} />}
    </div>
  );
}

export function LinkPanel({ r }: { r: LinkResult }) {
  const t = useTranslations("links");
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      window.prompt(t("copyManually"), text);
    }
  };
  const status = (s: LinkResult["email"], sent: string, failed: string) =>
    s === "sent" ? <li className="text-green-700">✓ {sent}</li> : s === "failed" ? <li className="text-red-600">✗ {failed}</li> : null;
  const delivered = r.email === "sent" || r.telegram === "sent";

  return (
    <div className="space-y-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm" role="status">
      <p className="font-medium text-green-800">{r.ok}</p>
      {r.link && (
        <>
          <ul className="space-y-0.5">
            {status(r.email, t("sentEmail"), t("failedEmail"))}
            {status(r.telegram, t("sentTelegram"), t("failedTelegram"))}
            {!delivered && <li className="text-amber-800">{t("notSent")}</li>}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 rounded-lg bg-surface p-3">
              <div className="font-medium">{t("inPerson")}</div>
              <div className="mx-auto w-40 bg-white p-1" dangerouslySetInnerHTML={{ __html: r.qr ?? "" }} />
              <button type="button" className="btn btn-sm w-full" onClick={() => copy(r.link!)}>
                {copied === r.link ? `✓ ${t("copied")}` : t("copyLink")}
              </button>
              <p className="text-xs text-gray-500">{t("linkValid")}</p>
            </div>
            {r.telegramLink && (
              <div className="space-y-2 rounded-lg bg-surface p-3">
                <div className="font-medium">{t("telegramTitle")}</div>
                <div className="mx-auto w-40 bg-white p-1" dangerouslySetInnerHTML={{ __html: r.telegramQr ?? "" }} />
                <button type="button" className="btn btn-sm w-full" onClick={() => copy(r.telegramLink!)}>
                  {copied === r.telegramLink ? `✓ ${t("copied")}` : t("copyTelegram")}
                </button>
                <p className="text-xs text-gray-500">{t("telegramHelp")}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
