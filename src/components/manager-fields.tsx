"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { suggestUsername } from "@/lib/translit";

/** New manager: first/last name, suggested username, optional email (they get an invite link). */
export function ManagerFields({ required = false }: { required?: boolean }) {
  const t = useTranslations();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      <div>
        <label className="label">{t("common.firstName")}</label>
        <input name="mFirst" className="input" required={required} value={first} onChange={(e) => setFirst(e.target.value)} />
      </div>
      <div>
        <label className="label">{t("common.lastName")}</label>
        <input name="mLast" className="input" required={required} value={last} onChange={(e) => setLast(e.target.value)} />
      </div>
      <div>
        <label className="label">{t("common.username")}</label>
        <input name="mUsername" className="input" autoCapitalize="none" value={username ?? suggestUsername(first, last)} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div>
        <label className="label">{t("account.emailOptional")}</label>
        <input name="mEmail" type="email" className="input" />
      </div>
    </div>
  );
}
