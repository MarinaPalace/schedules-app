"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher, type Theme } from "@/components/theme-switcher";
import { Count } from "@/components/nav";

export type MobileNavItem = { href: string; label: string; icon: string; section?: string; badge?: number };

/** Bottom tab bar for phones: the main screens for this role + a menu with everything else. */
export function MobileNav({
  primary,
  all,
  theme,
  signOut,
  userLine,
}: {
  primary: MobileNavItem[];
  all: MobileNavItem[];
  theme: Theme;
  signOut: () => Promise<void>;
  userLine: string;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  // Waiting items that are only reachable through the menu.
  const hidden = all.filter((i) => !primary.some((p) => p.href === i.href)).reduce((s, i) => s + (i.badge ?? 0), 0);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="flex">
          {primary.map((item) => (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium ${isActive(item.href) ? "text-blue-600" : "text-gray-500"}`}
              >
                <span className="relative">
                  <Icon name={item.icon} />
                  {item.badge ? <Count n={item.badge} className="absolute -top-1.5 -right-3" /> : null}
                </span>
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          ))}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium text-gray-500"
            >
              <span className="relative">
                <Icon name="menu" />
                {hidden ? <Count n={hidden} className="absolute -top-1.5 -right-3" /> : null}
              </span>
              <span>{t("nav.menu")}</span>
            </button>
          </li>
        </ul>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:hidden" role="dialog" aria-modal="true">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label={t("common.close")} onClick={() => setOpen(false)} />
          <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-gray-300" />
            <div className="mb-3 text-sm text-gray-500">{userLine}</div>
            <ul className="grid grid-cols-2 gap-2">
              {all.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex min-h-14 items-center gap-2 rounded-xl border px-3 text-sm font-medium ${
                      isActive(item.href) ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-700"
                    }`}
                  >
                    <Icon name={item.icon} className="h-5 w-5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {item.badge ? <Count n={item.badge} className="ml-auto shrink-0" /> : null}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <LanguageSwitcher />
              <ThemeSwitcher initial={theme} />
            </div>
            <form action={signOut} className="mt-4">
              <button className="btn w-full">{t("common.signOut")}</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
