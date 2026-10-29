import { and, asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { loadLocations, loadRoles } from "@/lib/org";
import { getVisibleDepartments, requireUser } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { LinkTabs } from "@/components/toolbar";
import { createLocation, createRole, setEmployeePlanning, updateLocation, updateRole } from "./actions";

/** Per department: roles (Waiter…), locations (Restaurant 1, Bar 3…) and each person's usual role and place. */
export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const me = await requireUser(["manager", "top_manager", "owner", "admin"]);
  const t = await getTranslations();
  const deps = await getVisibleDepartments(me);
  if (!deps.length) return <p className="text-sm text-gray-500">{t("common.noDepartments")}</p>;
  const sp = (await searchParams) as { dept?: string };
  const dept = deps.find((d) => d.id === sp.dept) ?? deps[0];

  const [roles, places, staff] = await Promise.all([
    loadRoles([dept.id], true),
    loadLocations([dept.id], true),
    db
      .select()
      .from(employees)
      .where(and(eq(employees.departmentId, dept.id), eq(employees.active, true)))
      .orderBy(asc(employees.lastName), asc(employees.firstName)),
  ]);
  const activeRoles = roles.filter((r) => r.active);
  const activePlaces = places.filter((l) => l.active);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-2">
        <h1 className="page-title">{t("setup.title")}</h1>
        <p className="text-sm text-gray-500">{t("setup.help")}</p>
        {deps.length > 1 && <LinkTabs base="/setup" params={{}} name="dept" value={dept.id} options={deps.map((d) => ({ value: d.id, label: d.name }))} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-medium">{t("setup.roles")}</h2>
          <p className="text-xs text-gray-500">{t("setup.rolesHelp")}</p>
          {roles.map((r) => (
            <ActionForm key={r.id} action={updateRole} className={`flex flex-wrap items-end gap-2 ${r.active ? "" : "opacity-60"}`}>
              <input type="hidden" name="id" value={r.id} />
              <input name="name" defaultValue={r.name} className="input min-w-32 flex-1" aria-label={t("common.name")} required />
              <input name="sort" type="number" defaultValue={r.sort} className="input w-16" aria-label={t("setup.order")} />
              <label className="flex min-h-11 items-center gap-1.5 text-sm">
                <input type="checkbox" name="active" defaultChecked={r.active} /> {t("common.active")}
              </label>
              <SubmitButton className="btn btn-sm">{t("common.save")}</SubmitButton>
            </ActionForm>
          ))}
          <ActionForm action={createRole} resetOnSuccess className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
            <input type="hidden" name="departmentId" value={dept.id} />
            <div className="min-w-32 flex-1">
              <label className="label">{t("setup.newRole")}</label>
              <input name="name" className="input" placeholder={t("setup.rolePlaceholder")} required />
            </div>
            <input name="sort" type="number" defaultValue={roles.length + 1} className="input w-16" aria-label={t("setup.order")} />
            <SubmitButton className="btn">{t("common.add")}</SubmitButton>
          </ActionForm>
        </section>

        <section className="card space-y-3">
          <h2 className="font-medium">{t("setup.locations")}</h2>
          <p className="text-xs text-gray-500">{t("setup.locationsHelp")}</p>
          {places.map((l) => (
            <ActionForm key={l.id} action={updateLocation} className={`flex flex-wrap items-end gap-2 ${l.active ? "" : "opacity-60"}`}>
              <input type="hidden" name="id" value={l.id} />
              <input name="code" defaultValue={l.code} maxLength={6} className="input w-20 uppercase" aria-label={t("shifts.code")} required />
              <input name="name" defaultValue={l.name} className="input min-w-32 flex-1" aria-label={t("common.name")} required />
              <input name="sort" type="number" defaultValue={l.sort} className="input w-16" aria-label={t("setup.order")} />
              <label className="flex min-h-11 items-center gap-1.5 text-sm">
                <input type="checkbox" name="active" defaultChecked={l.active} /> {t("common.active")}
              </label>
              <SubmitButton className="btn btn-sm">{t("common.save")}</SubmitButton>
            </ActionForm>
          ))}
          <ActionForm action={createLocation} resetOnSuccess className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
            <input type="hidden" name="departmentId" value={dept.id} />
            <div className="w-20">
              <label className="label">{t("shifts.code")}</label>
              <input name="code" maxLength={6} className="input uppercase" placeholder="B1" required />
            </div>
            <div className="min-w-32 flex-1">
              <label className="label">{t("setup.newLocation")}</label>
              <input name="name" className="input" placeholder={t("setup.locationPlaceholder")} required />
            </div>
            <input name="sort" type="number" defaultValue={places.length + 1} className="input w-16" aria-label={t("setup.order")} />
            <SubmitButton className="btn">{t("common.add")}</SubmitButton>
          </ActionForm>
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">{t("setup.staff")}</h2>
        <p className="text-xs text-gray-500">{t("setup.staffHelp")}</p>
        <div className="card divide-y divide-gray-100 p-0 sm:p-0">
          {staff.map((e) => (
            <ActionForm key={e.id} action={setEmployeePlanning} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <input type="hidden" name="employeeId" value={e.id} />
              <div className="min-w-40 flex-1">
                <div className="font-medium">
                  {e.lastName} {e.firstName}
                </div>
                {e.position && <div className="text-xs text-gray-500">{e.position}</div>}
              </div>
              <select name="jobRoleId" defaultValue={e.jobRoleId ?? ""} className="input w-auto" aria-label={t("setup.role")}>
                <option value="">{t("setup.noRole")}</option>
                {activeRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <select name="homeLocationId" defaultValue={e.homeLocationId ?? ""} className="input w-auto" aria-label={t("setup.usualLocation")}>
                <option value="">{t("setup.noLocation")}</option>
                {activePlaces.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} – {l.name}
                  </option>
                ))}
              </select>
              <SubmitButton className="btn btn-sm">{t("common.save")}</SubmitButton>
            </ActionForm>
          ))}
          {staff.length === 0 && <p className="px-4 py-3 text-sm text-gray-500">{t("employees.none")}</p>}
        </div>
      </section>
    </div>
  );
}
