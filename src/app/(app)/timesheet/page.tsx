import Link from "next/link";
import { addDays, isISODate, monthOf } from "@/lib/calendar";
import { inputFromEntry } from "@/lib/day-input";
import { describeDay } from "@/lib/describe";
import { key, loadDepartmentEmployees, loadPendingCorrections, loadSchedule, loadTimesheet } from "@/lib/data";
import { formatDate, todayISO } from "@/lib/dates";
import { canManageDepartment, getVisibleDepartments, requireUser } from "@/lib/session";
import { TimesheetDay, type TimesheetRow } from "@/components/timesheet-day";
import { LinkTabs, PeriodNav, href } from "@/components/toolbar";
import { dayLabel } from "@/lib/calendar";

export default async function TimesheetPage({ searchParams }: PageProps<"/timesheet">) {
  const user = await requireUser(["manager", "top_manager", "owner", "accountant", "admin"]);
  const sp = (await searchParams) as { dept?: string; date?: string };
  const deps = await getVisibleDepartments(user);
  if (!deps.length) return <p className="text-sm text-gray-500">No departments assigned to you.</p>;
  const dept = deps.find((d) => d.id === sp.dept) ?? deps[0];
  const today = todayISO();
  const date = isISODate(sp.date) ? sp.date : today;

  const employees = await loadDepartmentEmployees(dept.id, date, date);
  const ids = employees.map((e) => e.id);
  const [schedule, timesheet, pending, editable] = await Promise.all([
    loadSchedule(ids, date, date),
    loadTimesheet(ids, date, date),
    loadPendingCorrections(ids, date, date),
    canManageDepartment(user, dept.id),
  ]);

  const rows: TimesheetRow[] = employees.map((e) => {
    const k = key(e.id, date);
    const plan = schedule.get(k);
    const ts = timesheet.get(k);
    const pc = pending.get(k);
    return {
      employeeId: e.id,
      name: `${e.lastName} ${e.firstName}`,
      position: e.position,
      planned: describeDay(plan),
      plannedInput: inputFromEntry(plan?.kind === "none" ? null : plan),
      approved: ts ? { version: ts.version, text: describeDay(ts), input: inputFromEntry(ts) } : null,
      pending: pc ? { text: describeDay(pc), reason: pc.reason } : null,
    };
  });
  // Scheduled people first, then the rest.
  rows.sort((a, b) => Number(b.plannedInput.kind !== "none") - Number(a.plannedInput.kind !== "none"));

  const approvedCount = rows.filter((r) => r.approved).length;
  const params = { dept: dept.id, date };

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-2">Forma 76</h1>
        <LinkTabs base="/timesheet" params={{ date }} name="dept" value={dept.id} options={deps.map((d) => ({ value: d.id, label: d.name }))} />
        <PeriodNav
          label={`${dayLabel(date).split(" ")[0]} ${formatDate(date)}`}
          prev={href("/timesheet", { ...params, date: addDays(date, -1) })}
          next={href("/timesheet", { ...params, date: addDays(date, 1) })}
          today={href("/timesheet", { dept: dept.id })}
        />
        <Link href={href("/timesheet/month", { dept: dept.id, month: monthOf(date) })} className="btn btn-sm">
          Month view &amp; export
        </Link>
      </div>
      <p className="text-sm text-gray-500">
        {approvedCount} of {rows.length} approved. Hours are pre-filled from the schedule – adjust what really happened, then approve.
      </p>
      <TimesheetDay
        key={`${dept.id}-${date}-${approvedCount}-${pending.size}-${timesheet.size}`}
        departmentId={dept.id}
        date={date}
        rows={rows}
        editable={editable}
        canApproveDate={date <= today}
      />
    </div>
  );
}
