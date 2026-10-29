"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { href } from "@/lib/href";
import { setPreferenceCookie } from "@/lib/client-cookie";

/** List / Table switch and "whole department" checkbox for the employee's month view (remembered per device). */
export function MeViewToggle({ month, view, team }: { month: string; view: "list" | "table"; team: boolean }) {
  const t = useTranslations("me");
  const router = useRouter();
  // Ticks at once; the page follows when the navigation finishes.
  const [checked, setChecked] = useState(team && view === "table");
  const [, start] = useTransition();
  const go = (v: "list" | "table", tm: boolean) => {
    setPreferenceCookie("meView", tm ? "team" : v);
    return href("/me", { month, view: v, team: tm ? "1" : undefined });
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded-xl border border-gray-300 bg-surface text-sm font-medium" role="tablist">
        {(["list", "table"] as const).map((v) => (
          <Link
            key={v}
            href={href("/me", { month, view: v, team: v === "table" && team ? "1" : undefined })}
            onClick={() => setPreferenceCookie("meView", v === "table" && team ? "team" : v)}
            role="tab"
            aria-selected={view === v}
            className={`min-h-11 px-4 py-2.5 ${view === v ? "bg-blue-600 text-white" : "text-gray-700"}`}
            scroll={false}
          >
            {t(v === "list" ? "viewList" : "viewTable")}
          </Link>
        ))}
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={checked}
          onChange={(e) => {
            const on = e.target.checked;
            setChecked(on);
            start(() => router.push(go("table", on), { scroll: false }));
          }}
        />
        {t("wholeDepartment")}
      </label>
    </div>
  );
}
