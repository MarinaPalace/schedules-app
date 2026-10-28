import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/db/client";
import { correctionDecisions, correctionRequests, employees, scheduleEntries, timesheetEntries, user } from "@/db/schema";
import { isISODate } from "@/lib/calendar";
import { describeDay } from "@/lib/describe";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getVisibleDepartments, requireUser } from "@/lib/session";

export default async function HistoryPage({ searchParams }: PageProps<"/schedule/history">) {
  const me = await requireUser(["manager", "top_manager", "owner", "accountant", "admin"]);
  const { employee, date } = (await searchParams) as { employee?: string; date?: string };
  if (!z.uuid().safeParse(employee).success || !isISODate(date)) notFound();

  const emp = await db.query.employees.findFirst({ where: eq(employees.id, employee!) });
  if (!emp) notFound();
  const visible = await getVisibleDepartments(me);
  if (!visible.some((d) => d.id === emp.departmentId)) notFound();

  const decider = alias(user, "decider");
  const [plan, actual, corrections] = await Promise.all([
    db
      .select({ e: scheduleEntries, by: user.name })
      .from(scheduleEntries)
      .leftJoin(user, eq(user.id, scheduleEntries.createdBy))
      .where(and(eq(scheduleEntries.employeeId, emp.id), eq(scheduleEntries.workDate, date)))
      .orderBy(asc(scheduleEntries.createdAt)),
    db
      .select({ e: timesheetEntries, by: user.name })
      .from(timesheetEntries)
      .leftJoin(user, eq(user.id, timesheetEntries.createdBy))
      .where(and(eq(timesheetEntries.employeeId, emp.id), eq(timesheetEntries.workDate, date)))
      .orderBy(asc(timesheetEntries.version)),
    db
      .select({ r: correctionRequests, d: correctionDecisions, by: user.name, decidedBy: decider.name })
      .from(correctionRequests)
      .leftJoin(correctionDecisions, eq(correctionDecisions.requestId, correctionRequests.id))
      .leftJoin(user, eq(user.id, correctionRequests.createdBy))
      .leftJoin(decider, eq(decider.id, correctionDecisions.createdBy))
      .where(and(eq(correctionRequests.employeeId, emp.id), eq(correctionRequests.workDate, date)))
      .orderBy(asc(correctionRequests.createdAt)),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/schedule?dept=${emp.departmentId}&start=${date}`} className="text-sm text-blue-700 hover:underline">← Schedule</Link>
        <h1 className="page-title mt-1">
          {emp.firstName} {emp.lastName} · {formatDate(date!)}
        </h1>
      </div>

      <section className="card">
        <h2 className="mb-3 font-medium">Schedule changes</h2>
        {plan.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing planned for this day.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {plan.map(({ e, by }, i) => (
              <li key={e.id} className={i === plan.length - 1 ? "font-medium" : "text-gray-500 line-through decoration-gray-300"}>
                {describeDay(e)} <span className="font-normal text-gray-400 no-underline">— {by ?? "system"}, {formatDateTime(e.createdAt)}{e.note ? ` (${e.note})` : ""}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">Forma 76 (approved actual hours)</h2>
        {actual.length === 0 ? (
          <p className="text-sm text-gray-500">Not approved yet.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {actual.map(({ e, by }) => (
              <li key={e.id}>
                <span className="badge mr-2">v{e.version}</span>
                {describeDay(e)} <span className="text-gray-400">— {by}, {formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {corrections.length > 0 && (
        <section className="card">
          <h2 className="mb-3 font-medium">Correction requests</h2>
          <ul className="space-y-3 text-sm">
            {corrections.map(({ r, d, by, decidedBy }) => (
              <li key={r.id}>
                <div>
                  → {describeDay(r)} <span className="text-gray-400">— requested by {by}, {formatDateTime(r.createdAt)}</span>
                </div>
                <div className="text-gray-600">Reason: {r.reason}</div>
                <div>
                  {d ? (
                    <span className={d.decision === "approved" ? "text-green-700" : "text-red-700"}>
                      {d.decision} by {decidedBy}, {formatDateTime(d.createdAt)}
                      {d.note ? ` – ${d.note}` : ""}
                    </span>
                  ) : (
                    <span className="badge bg-amber-100 text-amber-800">pending</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
