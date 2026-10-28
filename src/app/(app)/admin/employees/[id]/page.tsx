import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { departments, employeeRates, employees, user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { formatEur } from "@/lib/money";
import { formatDate, formatDateTime, todayISO } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { addRate, createEmployeeLogin, resetPassword, updateEmployee } from "../actions";

export default async function EmployeePage({ params }: PageProps<"/admin/employees/[id]">) {
  await requireUser(["admin", "top_manager"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const emp = await db.query.employees.findFirst({ where: eq(employees.id, id) });
  if (!emp) notFound();

  const [deps, rates, login] = await Promise.all([
    db.select().from(departments).orderBy(asc(departments.name)),
    db
      .select()
      .from(employeeRates)
      .where(eq(employeeRates.employeeId, id))
      .orderBy(desc(employeeRates.effectiveFrom), desc(employeeRates.createdAt)),
    emp.userId ? db.query.user.findFirst({ where: eq(user.id, emp.userId) }) : null,
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/admin/employees" className="text-sm text-blue-700 hover:underline">← Employees</Link>
        <h1 className="page-title mt-1">
          {emp.firstName} {emp.lastName}
        </h1>
      </div>

      <section className="card">
        <h2 className="mb-3 font-medium">Details</h2>
        <ActionForm action={updateEmployee} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={emp.id} />
          <div>
            <label className="label">First name</label>
            <input name="firstName" defaultValue={emp.firstName} className="input" required />
          </div>
          <div>
            <label className="label">Last name</label>
            <input name="lastName" defaultValue={emp.lastName} className="input" required />
          </div>
          <div>
            <label className="label">Department</label>
            <select name="departmentId" defaultValue={emp.departmentId} className="input">
              {deps.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Position</label>
            <input name="position" defaultValue={emp.position ?? ""} className="input" />
          </div>
          <div>
            <label className="label">Employee no.</label>
            <input name="employeeNo" defaultValue={emp.employeeNo ?? ""} className="input" />
          </div>
          <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="canViewDepartment" defaultChecked={emp.canViewDepartment} /> Can see department schedule
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="active" defaultChecked={emp.active} /> Active (unticking also blocks login)
            </label>
          </div>
          <div className="sm:col-span-2">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">Hourly rate history</h2>
        <p className="mb-3 text-sm text-gray-500">
          Rates are never overwritten. Add a new rate with the date it starts; past months keep their old rate.
        </p>
        <table className="table mb-4">
          <thead>
            <tr>
              <th>From</th>
              <th className="text-right">Rate / h</th>
              <th>Entered</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td>{formatDate(r.effectiveFrom)}</td>
                <td className="text-right tabular-nums">{formatEur(r.hourlyRateCents)}</td>
                <td className="text-gray-500">{formatDateTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ActionForm action={addRate} resetOnSuccess className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="employeeId" value={emp.id} />
          <div>
            <label className="label">New rate (€ / h)</label>
            <input name="hourlyRate" className="input w-32" inputMode="decimal" required />
          </div>
          <div>
            <label className="label">From</label>
            <input name="effectiveFrom" type="date" className="input" defaultValue={todayISO()} required />
          </div>
          <SubmitButton className="btn">Add rate</SubmitButton>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">App login</h2>
        {login ? (
          <div className="space-y-3">
            <p className="text-sm">
              Username: <span className="font-mono">{login.username}</span>
              {!login.active && <span className="badge ml-2">blocked</span>}
            </p>
            <ActionForm action={resetPassword} resetOnSuccess className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="userId" value={login.id} />
              <div>
                <label className="label">New password</label>
                <input name="password" className="input" autoComplete="new-password" required minLength={6} />
              </div>
              <SubmitButton className="btn">Reset password</SubmitButton>
            </ActionForm>
          </div>
        ) : (
          <ActionForm action={createEmployeeLogin} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="employeeId" value={emp.id} />
            <div>
              <label className="label">Username</label>
              <input name="username" className="input" autoCapitalize="none" required />
            </div>
            <div>
              <label className="label">Password</label>
              <input name="password" className="input" autoComplete="new-password" required minLength={6} />
            </div>
            <SubmitButton className="btn">Create login</SubmitButton>
          </ActionForm>
        )}
      </section>
    </div>
  );
}
