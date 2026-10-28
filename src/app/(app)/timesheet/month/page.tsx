import Link from "next/link";
import { addMonths, isMonth, isWeekend, monthLabel, monthOf } from "@/lib/calendar";
import { ABSENCE_CODES } from "@/lib/codes";
import { todayISO } from "@/lib/dates";
import { buildMonthSheet } from "@/lib/month-sheet";
import { getVisibleDepartments, requireUser } from "@/lib/session";
import { formatHours } from "@/lib/shifts";
import { LinkTabs, PeriodNav, href } from "@/components/toolbar";

export default async function TimesheetMonthPage({ searchParams }: PageProps<"/timesheet/month">) {
  const user = await requireUser(["manager", "top_manager", "owner", "accountant", "admin"]);
  const sp = (await searchParams) as { dept?: string; month?: string };
  const deps = await getVisibleDepartments(user);
  if (!deps.length) return <p className="text-sm text-gray-500">No departments assigned to you.</p>;
  const dept = deps.find((d) => d.id === sp.dept) ?? deps[0];
  const month = isMonth(sp.month) ? sp.month : monthOf(todayISO());
  const { dates, rows } = await buildMonthSheet(dept.id, month);
  const unapproved = rows.reduce((n, r) => n + r.cells.filter((c) => !c.approved && c.text).length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-2">Forma 76 – month</h1>
        <LinkTabs base="/timesheet/month" params={{ month }} name="dept" value={dept.id} options={deps.map((d) => ({ value: d.id, label: d.name }))} />
        <PeriodNav
          label={monthLabel(month)}
          prev={href("/timesheet/month", { dept: dept.id, month: addMonths(month, -1) })}
          next={href("/timesheet/month", { dept: dept.id, month: addMonths(month, 1) })}
        />
        <a href={href("/timesheet/export", { dept: dept.id, month })} className="btn btn-primary btn-sm">
          Download Excel (CSV)
        </a>
        <Link href={href("/timesheet", { dept: dept.id })} className="btn btn-sm">
          Daily approval
        </Link>
      </div>
      {unapproved > 0 && (
        <p className="text-sm text-amber-700">
          {unapproved} planned day(s) are not approved yet (shown grey in brackets). Only approved days count as actual.
        </p>
      )}

      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-gray-500">
              <th className="sticky left-0 z-10 min-w-40 border-b border-gray-200 bg-white px-3 py-2 text-left font-medium">Employee</th>
              {dates.map((d) => (
                <th key={d} className={`min-w-8 border-b border-l border-gray-200 px-1 py-2 text-center font-medium ${isWeekend(d) ? "bg-gray-50" : ""}`}>
                  <Link href={href("/timesheet", { dept: dept.id, date: d })} className="hover:text-blue-700">
                    {d.slice(8)}
                  </Link>
                </th>
              ))}
              <th className="border-b border-l border-gray-200 px-2 py-2 text-right font-medium">Approved h</th>
              <th className="border-b border-l border-gray-200 px-2 py-2 text-right font-medium">Not appr. h</th>
              {ABSENCE_CODES.map((a) => (
                <th key={a.code} title={a.label} className="border-b border-l border-gray-200 px-2 py-2 text-right font-medium">
                  {a.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId}>
                <td className="sticky left-0 z-10 border-b border-gray-100 bg-white px-3 py-1.5 font-medium whitespace-nowrap">{r.name}</td>
                {r.cells.map((c, i) => (
                  <td
                    key={dates[i]}
                    title={c.title}
                    className={`border-b border-l border-gray-100 px-1 py-1.5 text-center tabular-nums ${isWeekend(dates[i]) ? "bg-gray-50" : ""} ${
                      c.approved ? "font-medium text-gray-900" : "text-gray-400"
                    }`}
                  >
                    {c.text && !c.approved ? `(${c.text})` : c.text}
                  </td>
                ))}
                <td className="border-b border-l border-gray-100 px-2 text-right font-semibold tabular-nums">{formatHours(r.approvedMinutes)}</td>
                <td className="border-b border-l border-gray-100 px-2 text-right text-gray-500 tabular-nums">{r.plannedMinutes ? formatHours(r.plannedMinutes) : ""}</td>
                {ABSENCE_CODES.map((a) => (
                  <td key={a.code} className="border-b border-l border-gray-100 px-2 text-right tabular-nums">{r.absences[a.code] || ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
