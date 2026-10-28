"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Decide = (raw: { requestId: string; decision: "approved" | "rejected"; note?: string }) => Promise<{ error?: string; ok?: string }>;

/** Approve / reject with an optional note. */
export function DecisionButtons({ requestId, decide }: { requestId: string; decide: Decide }) {
  const router = useRouter();
  const t = useTranslations("common");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [pending, start] = useTransition();

  const send = (decision: "approved" | "rejected") =>
    start(async () => {
      const res = await decide({ requestId, decision, note });
      setMsg(res);
      if (!res.error) router.refresh();
    });

  return (
    <div className="space-y-2">
      <input className="input py-1 text-sm" placeholder={t("noteOptional")} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => send("approved")}>
          {t("approve")}
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => send("rejected")}>
          {t("reject")}
        </button>
      </div>
      {msg.error && <p className="text-xs text-red-600">{msg.error}</p>}
    </div>
  );
}
