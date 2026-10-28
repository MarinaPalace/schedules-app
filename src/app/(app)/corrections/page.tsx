import Link from "next/link";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { correctionDecisions, correctionRequests, departments, employees, timesheetEntries, user } from "@/db/schema";
import { describeDay } from "@/lib/describe";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getVisibleDepartments, requireUser } from "@/lib/session";
import { DecisionButtons } from "@/components/decision-buttons";
import { decideCorrection } from "../timesheet/actions";

export default async function CorrectionsPage() {
  const me = await requireUser(["manager", "top_manager", "admin", "owner"]);
  const canDecide = me.role === "top_manager" || me.role === "admin";
  const deptIds = (await getVisibleDepartments(me)).map((d) => d.id);
  if (!deptIds.length) return <p className="text-sm text-gray-500">No departments assigned to you.</p>;

  const decider = alias(user, "decider");
  // Builder factory: drizzle query builders are mutable, so build one per query.
  const base = () =>
    db
    .select({
      r: correctionRequests,
      d: correctionDecisions,
      old: timesheetEntries,
      emp: { first: employees.firstName, last: employees.lastName },
      dept: departments.name,
      by: user.name,
      decidedBy: decider.name,
    })
    .from(correctionRequests)
    .innerJoin(timesheetEntries, eq(timesheetEntries.id, correctionRequests.baseTimesheetId))
    .innerJoin(employees, eq(employees.id, correctionRequests.employeeId))
    .innerJoin(departments, eq(departments.id, timesheetEntries.departmentId))
    .leftJoin(correctionDecisions, eq(correctionDecisions.requestId, correctionRequests.id))
    .leftJoin(user, eq(user.id, correctionRequests.createdBy))
    .leftJoin(decider, eq(decider.id, correctionDecisions.createdBy));

  const [open, done] = await Promise.all([
    base().where(and(isNull(correctionDecisions.id), inArray(timesheetEntries.departmentId, deptIds))).orderBy(correctionRequests.createdAt),
    base()
      .where(and(isNotNull(correctionDecisions.id), inArray(timesheetEntries.departmentId, deptIds)))
      .orderBy(desc(correctionDecisions.createdAt))
      .limit(30),
  ]);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="page-title">Corrections of approved days</h1>
        <p className="text-sm text-gray-500">
          {canDecide ? "Approve or reject changes to days that were already approved." : "Changes you requested; the top manager decides."}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">Waiting ({open.length})</h2>
        {open.length === 0 && <p className="text-sm text-gray-500">Nothing waiting.</p>}
        {open.map(({ r, old, emp, dept, by }) => (
          <div key={r.id} className="card grid gap-4 md:grid-cols-[1fr_16rem]">
            <div className="space-y-1 text-sm">
              <div className="font-medium">
                {emp.last} {emp.first} · {dept} ·{" "}
                <Link className="text-blue-700 hover:underline" href={`/schedule/history?employee=${r.employeeId}&date=${r.workDate}`}>
                  {formatDate(r.workDate)}
                </Link>
              </div>
              <div>
                <span className="text-gray-500">Approved (v{old.version}): </span>
                <span className="line-through decoration-gray-400">{describeDay(old)}</span>
              </div>
              <div>
                <span className="text-gray-500">Proposed: </span>
                <span className="font-medium">{describeDay(r)}</span>
              </div>
              <div className="text-gray-600">Reason: {r.reason}</div>
              <div className="text-xs text-gray-400">
                Requested by {by}, {formatDateTime(r.createdAt)}
              </div>
            </div>
            {canDecide ? <DecisionButtons requestId={r.id} decide={decideCorrection} /> : <span className="badge self-start bg-amber-100 text-amber-800">pending</span>}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Recently decided</h2>
        <div className="card overflow-x-auto p-0 sm:p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Employee</th>
                <th>Change</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {done.map(({ r, d, old, emp, decidedBy }) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{formatDate(r.workDate)}</td>
                  <td className="whitespace-nowrap">
                    {emp.last} {emp.first}
                  </td>
                  <td className="text-xs">
                    {describeDay(old)} → {describeDay(r)}
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    <span className={d!.decision === "approved" ? "text-green-700" : "text-red-700"}>{d!.decision}</span> · {decidedBy}
                    {d!.note ? ` – ${d!.note}` : ""}
                  </td>
                </tr>
              ))}
              {done.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-gray-500">None yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
