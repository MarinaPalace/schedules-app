import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, user } from "@/db/schema";
import { requireUser, ROLE_LABELS, ROLES } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { resetPassword } from "../employees/actions";
import { createUser, updateUser } from "./actions";

function RoleSelect({ value }: { value?: string }) {
  return (
    <select name="role" defaultValue={value ?? "manager"} className="input">
      {ROLES.map((r) => (
        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
      ))}
    </select>
  );
}

export default async function UsersPage() {
  await requireUser(["admin"]);
  const users = await db.query.user.findMany({ orderBy: [asc(user.role), asc(user.name)] });
  const linked = new Set((await db.select({ userId: employees.userId }).from(employees)).map((e) => e.userId));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="page-title">Users &amp; roles</h1>
        <p className="text-sm text-gray-500">
          Managers, owner, accountants and admins. Employee logins are created on the employee page. Users are deactivated, never deleted.
        </p>
      </div>

      <div className="card">
        <h2 className="mb-3 font-medium">New user</h2>
        <ActionForm action={createUser} resetOnSuccess className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Name</label>
            <input name="name" className="input" required />
          </div>
          <div>
            <label className="label">Username</label>
            <input name="username" className="input" autoCapitalize="none" required />
          </div>
          <div>
            <label className="label">Password</label>
            <input name="password" className="input" autoComplete="new-password" required minLength={6} />
          </div>
          <div>
            <label className="label">Role</label>
            <RoleSelect />
          </div>
          <div className="sm:col-span-4">
            <SubmitButton>Create user</SubmitButton>
          </div>
        </ActionForm>
      </div>

      <div className="space-y-2">
        {users.map((u) => (
          <details key={u.id} className={`card ${u.active ? "" : "opacity-60"}`}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-3">
              <span className="font-medium">{u.name}</span>
              <span className="font-mono text-sm text-gray-500">{u.username}</span>
              <span className="badge">{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}</span>
              {linked.has(u.id) && <span className="badge">employee record</span>}
              {!u.active && <span className="badge">deactivated</span>}
            </summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <ActionForm action={updateUser} className="space-y-3">
                <input type="hidden" name="id" value={u.id} />
                <div>
                  <label className="label">Name</label>
                  <input name="name" defaultValue={u.name} className="input" required />
                </div>
                <div>
                  <label className="label">Role</label>
                  <RoleSelect value={u.role} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={u.active} /> Active (can log in)
                </label>
                <SubmitButton className="btn">Save</SubmitButton>
              </ActionForm>
              <ActionForm action={resetPassword} resetOnSuccess className="space-y-3">
                <input type="hidden" name="userId" value={u.id} />
                <div>
                  <label className="label">New password</label>
                  <input name="password" className="input" autoComplete="new-password" required minLength={6} />
                </div>
                <SubmitButton className="btn">Reset password</SubmitButton>
              </ActionForm>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
