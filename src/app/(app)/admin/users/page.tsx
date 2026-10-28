import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, user } from "@/db/schema";
import { assignableRoles, requireUser, ROLES, type Role } from "@/lib/session";
import { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations<never>>>;
import { ActionForm, SubmitButton } from "@/components/action-form";
import { resetPassword } from "../employees/actions";
import { createUser, updateUser } from "./actions";

function RoleSelect({ value, t, roles }: { value?: string; t: T; roles: Role[] }) {
  return (
    <select name="role" defaultValue={value ?? "manager"} className="input">
      {roles.map((r) => (
        <option key={r} value={r}>{t(`roles.${r}`)}</option>
      ))}
    </select>
  );
}

export default async function UsersPage() {
  const me = await requireUser(["admin", "owner"]);
  const roles = assignableRoles(me);
  const t = await getTranslations();
  const users = await db.query.user.findMany({ orderBy: [asc(user.role), asc(user.name)] });
  const linked = new Set((await db.select({ userId: employees.userId }).from(employees)).map((e) => e.userId));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="page-title">{t("users.title")}</h1>
        <p className="text-sm text-gray-500">
          {t("users.help")}
        </p>
      </div>

      <div className="card">
        <h2 className="mb-3 font-medium">{t("users.new")}</h2>
        <ActionForm action={createUser} resetOnSuccess className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="label">{t("common.name")}</label>
            <input name="name" className="input" required />
          </div>
          <div>
            <label className="label">{t("common.username")}</label>
            <input name="username" className="input" autoCapitalize="none" required />
          </div>
          <div>
            <label className="label">{t("common.password")}</label>
            <input name="password" className="input" autoComplete="new-password" required minLength={6} />
          </div>
          <div>
            <label className="label">{t("common.role")}</label>
            <RoleSelect t={t} roles={roles} />
          </div>
          <div className="sm:col-span-4">
            <SubmitButton>{t("users.create")}</SubmitButton>
          </div>
        </ActionForm>
      </div>

      <div className="space-y-2">
        {users.map((u) => (
          <details key={u.id} className={`card ${u.active ? "" : "opacity-60"}`}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-3">
              <span className="font-medium">{u.name}</span>
              <span className="font-mono text-sm text-gray-500">{u.username}</span>
              <span className="badge">{(ROLES as readonly string[]).includes(u.role) ? t(`roles.${u.role as Role}`) : u.role}</span>
              {linked.has(u.id) && <span className="badge">{t("users.employeeRecord")}</span>}
              {!u.active && <span className="badge">{t("users.deactivated")}</span>}
            </summary>
            {roles.includes(u.role as Role) && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <ActionForm action={updateUser} className="space-y-3">
                <input type="hidden" name="id" value={u.id} />
                <div>
                  <label className="label">{t("common.name")}</label>
                  <input name="name" defaultValue={u.name} className="input" required />
                </div>
                <div>
                  <label className="label">{t("common.role")}</label>
                  <RoleSelect t={t} roles={roles} value={u.role} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={u.active} /> {t("users.activeCanLogin")}
                </label>
                <SubmitButton className="btn">{t("common.save")}</SubmitButton>
              </ActionForm>
              <ActionForm action={resetPassword} resetOnSuccess className="space-y-3">
                <input type="hidden" name="userId" value={u.id} />
                <div>
                  <label className="label">{t("common.newPassword")}</label>
                  <input name="password" className="input" autoComplete="new-password" required minLength={6} />
                </div>
                <SubmitButton className="btn">{t("common.resetPassword")}</SubmitButton>
              </ActionForm>
            </div>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
