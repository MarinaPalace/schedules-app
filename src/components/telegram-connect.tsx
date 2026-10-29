"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { connectMyTelegram } from "@/app/(app)/account/actions";
import type { LinkResult } from "@/lib/link-result";

/** "Connect Telegram": opens the bot on this phone, or shows a QR to scan with another one. */
export function TelegramConnect({ bot }: { bot: string }) {
  const t = useTranslations("account");
  const router = useRouter();
  const [res, setRes] = useState<LinkResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-600">{t("telegramHelp", { bot: `@${bot}` })}</p>
      {!res?.telegramLink ? (
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => start(async () => setRes(await connectMyTelegram()))}
        >
          {pending ? "…" : t("connectTelegram")}
        </button>
      ) : (
        <div className="space-y-2">
          <a href={res.telegramLink} target="_blank" rel="noopener" className="btn btn-primary">
            {t("openTelegram")}
          </a>
          <div className="w-40 bg-white p-1" dangerouslySetInnerHTML={{ __html: res.telegramQr ?? "" }} />
          <p className="text-xs text-gray-500">{t("afterStart")}</p>
          <button type="button" className="btn btn-sm" onClick={() => router.refresh()}>
            {t("checkAgain")}
          </button>
        </div>
      )}
      {res?.error && <p className="text-red-600">{res.error}</p>}
    </div>
  );
}
