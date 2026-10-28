import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { departments } from "@/db/schema";
import { addDays, dateRange, isISODate, mondayOf } from "@/lib/calendar";
import { viewOfEntry, type CellView } from "@/lib/cell-view";
import { loadDepartmentEmployees, loadSchedule, loadShiftTemplates } from "@/lib/data";
import { formatDate, todayISO } from "@/lib/dates";
import { getEmployeeForUser, requireUser } from "@/lib/session";
import { ScheduleGrid } from "@/components/schedule-grid";
import { PeriodNav, href } from "@/components/toolbar";

export default async function MyDepartmentPage({ searchParams }: PageProps<"/me/department">) {
  const user = await requireUser();
  const emp = await getEmployeeForUser(user.id);
  if (!emp?.canViewDepartment) {
    return (
      <div className="space-y-2">
        <h1 className="page-title">Department schedule</h1>
        <p className="text-sm text-gray-500">You don&apos;t have access to the department schedule. Ask your manager.</p>
        <Link href="/me" className="text-sm text-blue-700 hover:underline">← My schedule</Link>
      </div>
    );
  }
  const sp = (await searchParams) as { start?: string };
  const today = todayISO();
  const from = mondayOf(isISODate(sp.start) ? sp.start : today);
  const to = addDays(from, 6);

  const [dept, employees, templates] = await Promise.all([
    db.query.departments.findFirst({ where: eq(departments.id, emp.departmentId) }),
    loadDepartmentEmployees(emp.departmentId, from, to),
    loadShiftTemplates(),
  ]);
  const schedule = await loadSchedule(employees.map((e) => e.id), from, to);
  const cells: Record<string, CellView> = {};
  for (const [k, e] of schedule) if (e.departmentId === emp.departmentId) cells[k] = viewOfEntry(e, templates);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/me" className="text-sm text-blue-700 hover:underline">← My schedule</Link>
        <h1 className="page-title mr-2">{dept?.name}</h1>
        <PeriodNav
          label={`${formatDate(from)} – ${formatDate(to)}`}
          prev={href("/me/department", { start: addDays(from, -7) })}
          next={href("/me/department", { start: addDays(from, 7) })}
          today="/me/department"
        />
      </div>
      <ScheduleGrid
        departmentId={emp.departmentId}
        dates={dateRange(from, to)}
        employees={employees.filter((e) => e.active).map((e) => ({ id: e.id, name: `${e.lastName} ${e.firstName}`, position: e.position }))}
        initialCells={cells}
        approved={{}}
        templates={[]}
        rates={{}}
        factor={1}
        editable={false}
        today={today}
        budget={null}
        weekStart={null}
        showCost={false}
      />
      <div className="flex flex-wrap gap-2 text-xs text-gray-600">
        {templates.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1">
            <span className="rounded px-1.5 py-0.5 font-semibold text-white" style={{ background: t.color }}>{t.code}</span>
            {t.name}
          </span>
        ))}
      </div>
    </div>
  );
}
