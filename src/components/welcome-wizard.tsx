"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { saveHotelProfile } from "@/app/(app)/admin/hotel/actions";
import { createUser } from "@/app/(app)/admin/users/actions";
import { finishWelcome } from "@/app/actions/guide";
import { LOCALES, LOCALE_LABELS } from "@/i18n/config";
import { suggestUsername } from "@/lib/translit";
import { LinkForm } from "@/components/link-form";

type Props = {
  hotelName: string;
  locale: string;
  factor: number;
  isAdminAccount: boolean;
  hasGm: boolean;
  email: boolean;
  telegram: boolean;
};

const STEPS = ["about", "hotel", "who", "notify"] as const;

/** The owner's first login: what the app is, the hotel, who sets it up, notifications – then the checklist. */
export function WelcomeWizard(p: Props) {
  const t = useTranslations("welcome");
  const tc = useTranslations();
  const [step, setStep] = useState(0);
  // Decided once: after inviting the GM here the page refreshes with hasGm – keep their invite panel (link/QR) on screen.
  const [inviteGm] = useState(!p.hasGm);
  const [hotelState, hotelAction, saving] = useActionState(async (prev: Awaited<ReturnType<typeof saveHotelProfile>>, form: FormData) => {
    const result = await saveHotelProfile(prev, form);
    if (result.ok) setStep(2);
    return result;
  }, {});

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <ol className="flex gap-1.5" aria-label={t("steps")}>
        {STEPS.map((s, i) => (
          <li key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-blue-600" : "bg-gray-200"}`} aria-current={i === step ? "step" : undefined}>
            <span className="sr-only">{t(`step.${s}`)}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="card space-y-4">
          <h1 className="text-xl font-semibold">{t("aboutTitle")}</h1>
          <p className="text-gray-700">{t("aboutLead")}</p>
          <ol className="space-y-2">
            {(["plan", "see", "forma", "cost"] as const).map((k, i) => (
              <li key={k} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">{i + 1}</span>
                <span className="text-sm">
                  <b>{t(`flow.${k}.title`)}</b> – {t(`flow.${k}.text`)}
                </span>
              </li>
            ))}
          </ol>
          <div className="rounded-xl bg-gray-50 p-3 text-sm">
            <div className="mb-1 font-medium">{t("whoDoesWhat")}</div>
            <ul className="space-y-1 text-gray-700">
              {(["owner", "gm", "manager", "accountant", "staff"] as const).map((k) => (
                <li key={k}>
                  <b>{t(`who.${k}.name`)}</b> – {t(`who.${k}.text`)}
                </li>
              ))}
            </ul>
          </div>
          <button type="button" className="btn btn-primary min-h-12 w-full" onClick={() => setStep(1)}>
            {t("start")} →
          </button>
        </section>
      )}

      {step === 1 && (
        <section className="card space-y-4">
          <h1 className="text-xl font-semibold">{t("hotelTitle")}</h1>
          <form action={hotelAction} className="space-y-4">
            <div>
              <label className="label" htmlFor="w-name">
                {tc("hotel.name")}
              </label>
              <input id="w-name" name="hotelName" defaultValue={p.hotelName} className="input" placeholder={tc("hotel.namePlaceholder")} required />
            </div>
            <div>
              <label className="label" htmlFor="w-lang">
                {tc("hotel.language")}
              </label>
              <select id="w-lang" name="defaultLocale" defaultValue={p.locale} className="input">
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_LABELS[l]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">{tc("hotel.languageHelp")}</p>
            </div>
            <div>
              <label className="label" htmlFor="w-factor">
                {tc("hotel.factor")}
              </label>
              <input id="w-factor" name="factor" defaultValue={p.factor} className="input w-28" inputMode="decimal" />
              <p className="mt-1 text-xs text-gray-500">{tc("hotel.factorHelp")}</p>
            </div>
            {hotelState.error && <p className="text-sm text-red-600">{hotelState.error}</p>}
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={() => setStep(0)}>
                ← {tc("common.previous")}
              </button>
              <button className="btn btn-primary flex-1" disabled={saving}>
                {saving ? "…" : `${t("saveNext")} →`}
              </button>
            </div>
          </form>
        </section>
      )}

      {step === 2 && (
        <section className="card space-y-4">
          <h1 className="text-xl font-semibold">{t("whoTitle")}</h1>
          <p className="text-sm text-gray-700">{t("whoLead")}</p>
          {p.isAdminAccount && <PersonInvite role="owner" title={t("ownerTitle")} text={t("ownerText")} />}
          {!inviteGm ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">✓ {t("gmExists")}</p> : <PersonInvite role="top_manager" title={t("gmTitle")} text={t("gmText")} />}
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={() => setStep(1)}>
              ← {tc("common.previous")}
            </button>
            <button type="button" className="btn btn-primary flex-1" onClick={() => setStep(3)}>
              {t("next")} →
            </button>
          </div>
          <p className="text-xs text-gray-500">{t("whoLater")}</p>
        </section>
      )}

      {step === 3 && (
        <section className="card space-y-4">
          <h1 className="text-xl font-semibold">{t("notifyTitle")}</h1>
          <p className="text-sm text-gray-700">{t("notifyLead")}</p>
          <ul className="space-y-1 text-sm">
            <li className={p.email ? "text-green-700" : "text-amber-700"}>{p.email ? "✓" : "○"} {t(p.email ? "emailOn" : "emailOff")}</li>
            <li className={p.telegram ? "text-green-700" : "text-amber-700"}>{p.telegram ? "✓" : "○"} {t(p.telegram ? "telegramOn" : "telegramOff")}</li>
          </ul>
          {(!p.email || !p.telegram) && <p className="text-xs text-gray-500">{t("notifyLater")}</p>}
          <form action={finishWelcome} className="flex gap-2">
            <button type="button" className="btn" onClick={() => setStep(2)}>
              ← {tc("common.previous")}
            </button>
            <button className="btn btn-primary min-h-12 flex-1">{t("finish")} →</button>
          </form>
          <Link href="/help" className="block text-center text-sm text-blue-700 hover:underline">
            {t("openGuide")}
          </Link>
        </section>
      )}
    </div>
  );
}

/** Name + username + email → login with an invite link/QR (the person chooses their password). */
function PersonInvite({ role, title, text }: { role: "owner" | "top_manager"; title: string; text: string }) {
  const t = useTranslations();
  const [name, setName] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const parts = name.trim().split(/\s+/);
  const suggested = suggestUsername(parts[0] ?? "", parts.slice(1).join(" "));
  return (
    <div className="space-y-2 rounded-xl border border-gray-200 p-3">
      <div className="font-medium">{title}</div>
      <p className="text-xs text-gray-600">{text}</p>
      <LinkForm action={createUser} replaceOnSuccess className="grid gap-2 sm:grid-cols-3 sm:items-end">
        <input type="hidden" name="role" value={role} />
        <div>
          <label className="label">{t("common.name")}</label>
          <input name="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">{t("common.username")}</label>
          <input name="username" className="input" autoCapitalize="none" required value={username ?? suggested} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="label">{t("account.emailOptional")}</label>
          <input name="email" type="email" className="input" />
        </div>
        <button className="btn btn-primary sm:col-span-3">{t("welcome.createInvite")}</button>
      </LinkForm>
    </div>
  );
}
