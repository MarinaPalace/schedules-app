"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/** "?" next to a page title: two or three sentences on what the page is for, and a link to the guide. */
export function PageHelp({ text }: { text: string }) {
  const t = useTranslations("guide");
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("whatIsThis")}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-surface text-sm font-semibold text-gray-600"
      >
        ?
      </button>
      {open && (
        <span role="note" className="absolute top-10 right-0 z-40 block w-72 rounded-xl border border-gray-200 bg-surface p-3 text-sm text-gray-700 shadow-lg sm:left-0 sm:right-auto">
          {text}
          <Link href="/help" className="mt-2 block text-blue-700 hover:underline">
            {t("openGuide")} →
          </Link>
        </span>
      )}
    </span>
  );
}
