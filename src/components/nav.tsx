"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; section?: string; badge?: number };

export function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {items.map((item, i) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const header = item.section && item.section !== items[i - 1]?.section ? item.section : null;
        return (
          <div key={item.href} className="shrink-0">
            {header && (
              <div className="mt-4 mb-1 hidden px-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase md:block">
                {header}
              </div>
            )}
            <Link
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm whitespace-nowrap ${
                active ? "bg-blue-50 font-medium text-blue-700" : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {item.label}
              {item.badge ? <Count n={item.badge} className="ml-2" /> : null}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

/** Red counter for things waiting for the user. */
export function Count({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] leading-none font-semibold text-white ${className}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
