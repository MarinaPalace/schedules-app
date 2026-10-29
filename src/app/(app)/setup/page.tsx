import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { isLocale } from "@/i18n/config";
import { href } from "@/lib/href";
import { loadLocations, loadRoles } from "@/lib/org";
import { ROLE_PRESETS, type PresetGroup } from "@/lib/presets";
import { getVisibleDepartments, requireUser } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ActionButton } from "@/components/action-button";
import { PageHelp } from "@/components/page-help";
import { LinkTabs } from "@/components/toolbar";
import { Disclosure } from "@/components/disclosure";
import { addPresetRole, createLocation, createRole, moveItem, rolesFromPositions, setEmployeePlanning, updateLocation, updateRole } from "./actions";

/** Per department: roles (Waiter…), locations (Restaurant 1, Bar 3…) and each person's usual role and place. */
export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const me = await requireUser(["manager", "top_manager", "owner", "admin"]);
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
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
  const oldPositions = [...new Set(staff.filter((e) => !e.jobRoleId && e.position?.trim()).map((e) => e.position!.trim()))];
  const lang = isLocale(locale) ? locale : "bg";
  const presetGroups = Object.keys(ROLE_PRESETS) as PresetGroup[];
  const has = (n: string) => roles.some((r) => r.name.toLowerCase() === n.toLowerCase());
  // What to do next on this page (in the order the work depends on).
  const next = !activePlaces.length ? "locations" : !activeRoles.length ? "roles" : staff.some((e) => !e.jobRoleId) ? "staff" : "needs";

  const arrows = (kind: "role" | "location", id: string, i: number, n: number) => (
    <span className="flex">
      <ActionButton action={moveItem} args={[kind, id, -1]} className="btn btn-sm px-2">
        <span aria-hidden className={i === 0 ? "opacity-30" : ""}>↑</span>
      </ActionButton>
      <ActionButton action={moveItem} args={[kind, id, 1]} className="btn btn-sm px-2">
        <span aria-hidden className={i === n - 1 ? "opacity-30" : ""}>↓</span>
      </ActionButton>
    </span>
  );

  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="page-title">{t("setup.title")}</h1>
          <PageHelp text={t("help.setup")} />
        </div>
        <p className="text-sm text-gray-500">{t("setup.help")}</p>
        {deps.length > 1 && <LinkTabs base="/setup" params={{}} name="dept" value={dept.id} options={deps.map((d) => ({ value: d.id, label: d.name }))} />}
      </div>

      <div className="card flex flex-wrap items-center gap-3 border-blue-200 bg-blue-50 py-3 text-sm">
        <span className="font-medium text-blue-800">{t("setup.next")}:</span>
        <span className="flex-1 text-blue-900">{t(`setup.nextStep.${next}`)}</span>
        {next === "needs" && (
          <Link href={href("/needs", { dept: dept.id })} className="btn btn-primary btn-sm">
            {t("nav.needs")} →
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3" id="locations">
          <h2 className="font-medium">1. {t("setup.locations")}</h2>
          <p className="text-xs text-gray-500">{t("setup.locationsHelp")}</p>
          {!places.length && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{t("empty.locationsText")}</p>}
          {places.map((l, i) => (
            <div key={l.id} className={`flex items-end gap-2 ${l.active ? "" : "opacity-60"}`}>
              {arrows("location", l.id, i, places.length)}
              <ActionForm action={updateLocation} className="flex flex-1 flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={l.id} />
                <input name="code" defaultValue={l.code} maxLength={6} className="input w-20 uppercase" aria-label={t("shifts.code")} required />
                <input name="name" defaultValue={l.name} className="input min-w-32 flex-1" aria-label={t("common.name")} required />
                <label className="flex min-h-11 items-center gap-1.5 text-sm">
                  <input type="checkbox" name="active" defaultChecked={l.active} /> {t("common.active")}
                </label>
                <SubmitButton className="btn btn-sm">{t("common.save")}</SubmitButton>
              </ActionForm>
            </div>
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
            <SubmitButton className="btn">{t("common.add")}</SubmitButton>
          </ActionForm>
        </section>

        <section className="card space-y-3" id="roles">
          <h2 className="font-medium">2. {t("setup.roles")}</h2>
          <p className="text-xs text-gray-500">{t("setup.rolesHelp")}</p>
          {!roles.length && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{t("empty.rolesText")}</p>}
          {roles.map((r, i) => (
            <div key={r.id} className={`flex items-end gap-2 ${r.active ? "" : "opacity-60"}`}>
              {arrows("role", r.id, i, roles.length)}
              <ActionForm action={updateRole} className="flex flex-1 flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={r.id} />
                <input name="name" defaultValue={r.name} className="input min-w-32 flex-1" aria-label={t("common.name")} required />
                <label className="flex min-h-11 items-center gap-1.5 text-sm">
                  <input type="checkbox" name="active" defaultChecked={r.active} /> {t("common.active")}
                </label>
                <SubmitButton className="btn btn-sm">{t("common.save")}</SubmitButton>
              </ActionForm>
            </div>
          ))}
          <ActionForm action={createRole} resetOnSuccess className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
            <input type="hidden" name="departmentId" value={dept.id} />
            <div className="min-w-32 flex-1">
              <label className="label">{t("setup.newRole")}</label>
              <input name="name" className="input" placeholder={t("setup.rolePlaceholder")} required />
            </div>
            <SubmitButton className="btn">{t("common.add")}</SubmitButton>
          </ActionForm>
          <Disclosure className="rounded-lg bg-gray-50 p-3 text-sm" defaultOpen={!roles.length}>
            <summary className="cursor-pointer font-medium">{t("setup.presets")}</summary>
            <div className="mt-2 space-y-2">
              {presetGroups.map((g) => (
                <div key={g} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-28 shrink-0 text-xs text-gray-500">{t(`setup.presetGroup.${g}`)}</span>
                  {ROLE_PRESETS[g][lang].map((n) =>
                    has(n) ? (
                      <span key={n} className="badge bg-green-100 text-green-800">✓ {n}</span>
                    ) : (
                      <ActionButton key={n} action={addPresetRole} args={[dept.id, n]} className="btn btn-sm">
                        + {n}
                      </ActionButton>
                    ),
                  )}
                </div>
              ))}
            </div>
          </Disclosure>
          {oldPositions.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="text-amber-900">{t("setup.oldPositions", { list: oldPositions.join(", ") })}</p>
              <ActionButton action={rolesFromPositions} args={[dept.id]} className="btn btn-sm">
                {t("setup.makeRoles")}
              </ActionButton>
            </div>
          )}
        </section>
      </div>

      <section className="space-y-2" id="staff">
        <h2 className="font-medium">3. {t("setup.staff")}</h2>
        <p className="text-xs text-gray-500">{t("setup.staffHelp")}</p>
        <div className="card divide-y divide-gray-100 p-0 sm:p-0">
          {staff.map((e) => (
            <ActionForm key={e.id} action={setEmployeePlanning} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <input type="hidden" name="employeeId" value={e.id} />
              <div className="min-w-40 flex-1">
                <div className="font-medium">
                  {e.lastName} {e.firstName}
                </div>
                {!e.jobRoleId && e.position && <div className="text-xs text-amber-700">{e.position}</div>}
              </div>
              <select name="jobRoleId" defaultValue={e.jobRoleId ?? ""} className="input w-auto" aria-label={t("common.position")}>
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
          {staff.length === 0 && (
            <div className="space-y-2 px-4 py-4 text-sm text-gray-600">
              <p>{t("empty.staffText")}</p>
              <Link href={href("/admin/employees", { dept: dept.id })} className="btn btn-primary btn-sm">
                + {t("employees.add")}
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
