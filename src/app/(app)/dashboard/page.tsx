import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { getVisibleDepartments, requireUser } from "@/lib/session";

export default async function DashboardPage() {
  const user = await requireUser(["manager", "top_manager", "owner", "accountant", "admin"]);
  const deps = await getVisibleDepartments(user);
  const ids = deps.map((d) => d.id);
  const counts = ids.length
    ? await db
        .select({ departmentId: employees.departmentId, n: sql<number>`count(*)::int` })
        .from(employees)
        .where(and(inArray(employees.departmentId, ids), eq(employees.active, true)))
        .groupBy(employees.departmentId)
    : [];

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="text-sm text-gray-500">Budget vs actual vs projected labour cost arrives in Phase 4.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {deps.map((d) => (
          <div key={d.id} className="card">
            <div className="text-sm text-gray-500">{d.name}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{counts.find((c) => c.departmentId === d.id)?.n ?? 0}</div>
            <div className="text-xs text-gray-500">active employees</div>
          </div>
        ))}
        {deps.length === 0 && <p className="text-sm text-gray-500">No departments assigned to you yet.</p>}
      </div>
    </div>
  );
}
