import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/db/client";
import { departments } from "@/db/schema";
import { dayLabel, mondayOf, monthLabel } from "@/lib/calendar";
import { href } from "@/lib/href";
import { formatEur } from "@/lib/money";
import { departmentGaps, needsCost } from "@/lib/needs";
import { formatHours } from "@/lib/shifts";
import { inArray } from "drizzle-orm";

const SHOW = 8;

/** Dashboard: coming days where the plan is short of the staffing needs (e.g. "R2 Tue 06:30–08:30: 1 Waiter missing"). */
export async function NeedsGaps({ departmentIds, from, to }: { departmentIds: string[]; from: string; to: string }) {
  const gaps = await departmentGaps(departmentIds, from, to);
  if (!gaps.length) return null;
  const t = await getTranslations("needs");
  const locale = await getLocale();
  return (
    <section className="card space-y-2 border-red-200 bg-red-50 py-3 text-sm">
      <h2 className="font-semibold text-red-800">{t("gapsTitle", { count: gaps.length })}</h2>
      <ul className="space-y-1">
        {gaps.slice(0, SHOW).map((g, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-2">
            <span className="w-24 shrink-0 font-medium">{dayLabel(g.date, locale)}</span>
            <span className="badge">{g.locationCode}</span>
            <span>
              {g.from}–{g.to}: {t("missing", { count: g.missing, role: g.roleName })}
            </span>
            <Link href={href("/schedule", { dept: g.departmentId, view: "week", start: mondayOf(g.date) })} className="ml-auto text-blue-700 hover:underline">
              {t("open")}
            </Link>
          </li>
        ))}
      </ul>
      {gaps.length > SHOW && <p className="text-xs text-red-700">{t("more", { count: gaps.length - SHOW })}</p>}
    </section>
  );
}

/** Budgets page: what the staffing needs of the month would cost, as a starting point for the budget. */
export async function NeedsCost({ departmentIds, month, factor }: { departmentIds: string[]; month: string; factor: number }) {
  const cost = await needsCost(departmentIds, month, factor);
  if (!cost.size) return null;
  const t = await getTranslations("needs");
  const locale = await getLocale();
  const names = await db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, [...cost.keys()]));
  return (
    <section className="card space-y-2 text-sm">
      <h2 className="font-medium">{t("costTitle", { month: monthLabel(month, locale) })}</h2>
      <p className="text-xs text-gray-500">{t("costHelp")}</p>
      <table className="table">
        <thead>
          <tr>
            <th>{t("department")}</th>
            <th className="text-right">{t("hours")}</th>
            <th className="text-right">{t("pay")}</th>
            <th className="text-right">{t("totalCost")}</th>
          </tr>
        </thead>
        <tbody>
          {[...cost.entries()].map(([id, c]) => (
            <tr key={id}>
              <td>{names.find((n) => n.id === id)?.name}</td>
              <td className="text-right tabular-nums">{formatHours(c.minutes)}</td>
              <td className="text-right tabular-nums">{formatEur(c.payCents)}</td>
              <td className="text-right font-medium tabular-nums">{formatEur(c.costCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
