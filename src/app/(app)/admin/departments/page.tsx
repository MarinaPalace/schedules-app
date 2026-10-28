import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { departmentManagers, departments, employees, user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createDepartment, setDepartmentManagers, updateDepartment } from "./actions";

export default async function DepartmentsPage() {
  await requireUser(["admin", "top_manager"]);

  const [rows, managers, links] = await Promise.all([
    db
      .select({
        id: departments.id,
        name: departments.name,
        active: departments.active,
        staff: sql<number>`(select count(*)::int from ${employees} where ${employees.departmentId} = ${departments.id} and ${employees.active})`,
      })
      .from(departments)
      .orderBy(asc(departments.name)),
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.role, "manager")).orderBy(asc(user.name)),
    db.select().from(departmentManagers).where(eq(departmentManagers.active, true)),
  ]);

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="page-title">Departments</h1>

      <div className="card">
        <ActionForm action={createDepartment} resetOnSuccess className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label className="label">New department</label>
            <input name="name" className="input" placeholder="e.g. Spa" required />
          </div>
          <SubmitButton>Add</SubmitButton>
        </ActionForm>
      </div>

      <div className="space-y-3">
        {rows.map((d) => {
          const assigned = new Set(links.filter((l) => l.departmentId === d.id).map((l) => l.userId));
          return (
            <div key={d.id} className={`card space-y-4 ${d.active ? "" : "opacity-60"}`}>
              <ActionForm action={updateDepartment} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={d.id} />
                <div className="min-w-48 flex-1">
                  <label className="label">Name · {d.staff} active staff</label>
                  <input name="name" defaultValue={d.name} className="input" required />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={d.active} /> Active
                </label>
                <SubmitButton className="btn">Save</SubmitButton>
              </ActionForm>

              <ActionForm action={setDepartmentManagers}>
                <input type="hidden" name="departmentId" value={d.id} />
                <div className="label">Managers</div>
                {managers.length === 0 ? (
                  <p className="text-sm text-gray-500">No users with the Manager role yet (Users &amp; roles).</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {managers.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="managerIds" value={m.id} defaultChecked={assigned.has(m.id)} />
                        {m.name}
                      </label>
                    ))}
                    <SubmitButton className="btn btn-sm">Save managers</SubmitButton>
                  </div>
                )}
              </ActionForm>
            </div>
          );
        })}
      </div>
    </div>
  );
}
