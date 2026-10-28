"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { setLocale } from "@/app/actions/locale";
import { LOCALES, LOCALE_LABELS } from "@/i18n/config";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className={`inline-flex overflow-hidden rounded-lg border border-gray-300 bg-white text-xs ${className}`}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          title={LOCALE_LABELS[l]}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await setLocale(l);
              router.refresh();
            })
          }
          className={`px-2 py-1 font-medium uppercase ${l === locale ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
