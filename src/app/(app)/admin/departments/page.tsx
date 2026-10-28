import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { departmentManagers, departments, employees, user } from "@/db/schema";
import { PEOPLE_ADMINS, requireUser } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createDepartment, setDepartmentManagers, updateDepartment } from "./actions";
import { getTranslations } from "next-intl/server";

export default async function DepartmentsPage() {
  await requireUser(PEOPLE_ADMINS);
  const t = await getTranslations();

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
    db.select({ id: user.id, name: user.name }).from(user).where(and(inArray(user.role, ["manager", "top_manager"]), eq(user.active, true))).orderBy(asc(user.name)),
    db.select().from(departmentManagers).where(eq(departmentManagers.active, true)),
  ]);

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="page-title">{t("departments.title")}</h1>

      <div className="card">
        <ActionForm action={createDepartment} resetOnSuccess className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label className="label">{t("departments.new")}</label>
            <input name="name" className="input" placeholder={t("departments.placeholder")} required />
          </div>
          <SubmitButton>{t("common.add")}</SubmitButton>
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
                  <label className="label">{t("departments.staffCount", { count: d.staff })}</label>
                  <input name="name" defaultValue={d.name} className="input" required />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={d.active} /> {t("common.active")}
                </label>
                <SubmitButton className="btn">{t("common.save")}</SubmitButton>
              </ActionForm>

              <ActionForm action={setDepartmentManagers}>
                <input type="hidden" name="departmentId" value={d.id} />
                <div className="label">{t("departments.managers")}</div>
                {managers.length === 0 ? (
                  <p className="text-sm text-gray-500">{t("departments.noManagers")}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {managers.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="managerIds" value={m.id} defaultChecked={assigned.has(m.id)} />
                        {m.name}
                      </label>
                    ))}
                    <SubmitButton className="btn btn-sm">{t("departments.saveManagers")}</SubmitButton>
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
