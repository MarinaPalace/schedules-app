"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { setPreferenceCookie } from "@/lib/client-cookie";

export type Theme = "light" | "dark" | "system";

/** Light / dark / follow the phone. Saved in a cookie so the server renders the right colours. */
export function ThemeSwitcher({ initial, className = "" }: { initial: Theme; className?: string }) {
  const t = useTranslations("theme");
  const [theme, setTheme] = useState<Theme>(initial);

  function choose(next: Theme) {
    setTheme(next);
    setPreferenceCookie("theme", next);
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (next !== "system") root.classList.add(next);
  }

  const options: { value: Theme; icon: string }[] = [
    { value: "light", icon: "☀" },
    { value: "dark", icon: "☾" },
    { value: "system", icon: "◐" },
  ];
  return (
    <div className={`inline-flex overflow-hidden rounded-lg border border-gray-300 bg-surface text-xs ${className}`} role="radiogroup" aria-label={t("label")}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          title={t(o.value)}
          onClick={() => choose(o.value)}
          className={`flex min-h-9 items-center gap-1 px-2.5 py-1 font-medium ${theme === o.value ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
        >
          <span aria-hidden>{o.icon}</span>
          <span>{t(o.value)}</span>
        </button>
      ))}
    </div>
  );
}
