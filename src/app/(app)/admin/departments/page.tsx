import Link from "next/link";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/db/client";
import { departmentManagers, departments, employees, user } from "@/db/schema";
import { href } from "@/lib/href";
import { PEOPLE_ADMINS, requireUser } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { LinkForm } from "@/components/link-form";
import { ManagerFields } from "@/components/manager-fields";
import { PageHelp } from "@/components/page-help";
import { Disclosure } from "@/components/disclosure";
import { addDepartmentManager, createDepartmentWizard, setDepartmentManagers, updateDepartment } from "./actions";

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
  const active = rows.filter((d) => d.active);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="page-title">{t("departments.title")}</h1>
        <PageHelp text={t("help.departments")} />
        {rows.length > 0 && (
          <Link href="/admin/progress" className="btn btn-sm ml-auto">
            {t("nav.progress")}
          </Link>
        )}
      </div>

      <Disclosure className="card" defaultOpen={rows.length === 0}>
        <summary className="cursor-pointer font-medium">+ {t("departments.new")}</summary>
        <p className="mt-2 text-sm text-gray-500">{t("departments.wizardHelp")}</p>
        <LinkForm action={createDepartmentWizard} resetOnSuccess className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="d-name">1. {t("common.name")}</label>
              <input id="d-name" name="name" className="input" placeholder={t("departments.placeholder")} required />
            </div>
            <div>
              <label className="label" htmlFor="d-preset">2. {t("departments.preset")}</label>
              <select id="d-preset" name="preset" className="input" defaultValue="">
                <option value="">{t("departments.presetNone")}</option>
                {(["fnb", "housekeeping", "frontOffice", "kitchen"] as const).map((g) => (
                  <option key={g} value={g}>
                    {t(`setup.presetGroup.${g}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="d-copy">{t("departments.copyFrom")}</label>
              <select id="d-copy" name="copyFrom" className="input" defaultValue="">
                <option value="">–</option>
                {active.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="legends" defaultChecked className="h-5 w-5" /> {t("departments.addLegends")}
          </label>
          <div className="space-y-2 rounded-xl bg-gray-50 p-3">
            <div className="text-sm font-medium">3. {t("departments.managers")}</div>
            {managers.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {managers.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="managerIds" value={m.id} /> {m.name}
                  </label>
                ))}
              </div>
            )}
            <div className="text-xs text-gray-500">{t("departments.newManagerHelp")}</div>
            <ManagerFields />
          </div>
          <SubmitButton>{t("departments.create")}</SubmitButton>
        </LinkForm>
      </Disclosure>

      {rows.length === 0 && <EmptyState icon="admin" title={t("empty.departmentsTitle")} text={t("empty.departmentsText")} />}

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
                <Link href={href("/setup", { dept: d.id })} className="btn">
                  {t("nav.setup")}
                </Link>
              </ActionForm>

              <ActionForm action={setDepartmentManagers}>
                <input type="hidden" name="departmentId" value={d.id} />
                <div className="label">{t("departments.managers")}</div>
                {managers.length === 0 ? (
                  <p className="text-sm text-gray-500">{t("departments.noManagersYet")}</p>
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

              <details>
                <summary className="cursor-pointer text-sm font-medium text-blue-700">+ {t("departments.addNewManager")}</summary>
                <LinkForm action={addDepartmentManager} resetOnSuccess className="mt-2 space-y-2">
                  <input type="hidden" name="departmentId" value={d.id} />
                  <ManagerFields required />
                  <SubmitButton className="btn">{t("departments.inviteManager")}</SubmitButton>
                </LinkForm>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
