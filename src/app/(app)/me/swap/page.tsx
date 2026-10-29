import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { addDays, dateRange, isISODate } from "@/lib/calendar";
import { viewOfEntry, type CellView } from "@/lib/cell-view";
import { key, loadShiftTemplates, loadTimesheet } from "@/lib/data";
import { getDayLabels } from "@/lib/day-labels";
import { todayISO } from "@/lib/dates";
import { loadPublishedSchedule } from "@/lib/published";
import { getEmployeeForUser, requireUser } from "@/lib/session";
import { SwapForm } from "@/components/swap-form";

/** How many days ahead the form offers. */
const DAYS = 42;

export default async function NewSwapPage({ searchParams }: PageProps<"/me/swap">) {
  const user = await requireUser();
  const emp = await getEmployeeForUser(user.id);
  const [t, labels] = await Promise.all([getTranslations(), getDayLabels()]);
  if (!emp?.active) return <p className="text-sm text-gray-500">{t("me.notLinked")}</p>;
  const sp = (await searchParams) as { date?: string; with?: string };
  const today = todayISO();
  const dates = dateRange(today, addDays(today, DAYS - 1));

  const people = await db
    .select({ id: employees.id, first: employees.firstName, last: employees.lastName, position: employees.position, userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.departmentId, emp.departmentId), eq(employees.active, true)))
    .orderBy(asc(employees.lastName), asc(employees.firstName));
  const ids = people.map((p) => p.id);
  const [plan, timesheet, templates] = await Promise.all([loadPublishedSchedule(ids, dates[0], dates.at(-1)!), loadTimesheet(ids, dates[0], dates.at(-1)!), loadShiftTemplates()]);

  const cells: Record<string, CellView> = {};
  for (const [k, e] of plan) cells[k] = viewOfEntry(e, templates, labels);
  const locked: Record<string, true> = {};
  for (const p of ids) for (const d of dates) if (timesheet.has(key(p, d))) locked[key(p, d)] = true;

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <Link href="/me" className="text-sm text-blue-700 hover:underline">{t("me.backToMine")}</Link>
        <h1 className="page-title mt-1">{t("swaps.newTitle")}</h1>
        <p className="text-sm text-gray-500">{t("swaps.newHelp")}</p>
      </div>
      <SwapForm
        meId={emp.id}
        people={people.filter((p) => p.id !== emp.id).map((p) => ({ id: p.id, name: `${p.last} ${p.first}`, position: p.position, hasLogin: !!p.userId }))}
        dates={dates}
        cells={cells}
        locked={locked}
        initialDate={isISODate(sp.date) && dates.includes(sp.date) ? sp.date : null}
        initialWith={sp.with && ids.includes(sp.with) ? sp.with : null}
      />
    </div>
  );
}
