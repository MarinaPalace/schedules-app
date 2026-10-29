import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { href } from "@/lib/href";
import { PEOPLE_ADMINS, requireUser } from "@/lib/session";
import { departmentProgress } from "@/lib/setup-status";
import { EmptyState } from "@/components/empty-state";
import { PageHelp } from "@/components/page-help";

/** Owner/GM: how far each department is with its set-up – who is behind at a glance. */
export default async function ProgressPage() {
  await requireUser(PEOPLE_ADMINS);
  const t = await getTranslations();
  const rows = await departmentProgress();
  const cell = (ok: boolean, text: string, link: string) => (
    <td className="whitespace-nowrap">
      <Link href={link} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium hover:underline ${ok ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
        {ok ? "✓" : "○"} {text}
      </Link>
    </td>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="page-title">{t("progress.title")}</h1>
        <PageHelp text={t("help.progress")} />
      </div>
      <p className="text-sm text-gray-500">{t("progress.help")}</p>
      {rows.length === 0 ? (
        <EmptyState icon="admin" title={t("empty.departmentsTitle")} text={t("empty.departmentsText")} action={{ href: "/admin/departments", label: t("empty.addDepartment") }} />
      ) : (
        <div className="card overflow-x-auto p-0 sm:p-0">
          <table className="table">
            <thead>
              <tr>
                <th>{t("common.department")}</th>
                <th>{t("progress.manager")}</th>
                <th>{t("setup.locations")}</th>
                <th>{t("setup.roles")}</th>
                <th>{t("nav.needs")}</th>
                <th>{t("nav.shifts")}</th>
                <th>{t("progress.staff")}</th>
                <th>{t("progress.logins")}</th>
                <th>{t("progress.schedule")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="font-medium whitespace-nowrap">{d.name}</td>
                  {cell(
                    d.managers > 0 && d.managersActive === d.managers,
                    d.managers ? `${d.managerNames.join(", ")}${d.managersActive < d.managers ? ` · ${t("progress.notLoggedIn", { count: d.managers - d.managersActive })}` : ""}` : t("progress.none"),
                    "/admin/departments",
                  )}
                  {cell(d.locations > 0, String(d.locations), href("/setup", { dept: d.id }))}
                  {cell(d.roles > 0, String(d.roles), href("/setup", { dept: d.id }))}
                  {cell(d.needs > 0, String(d.needs), href("/needs", { dept: d.id }))}
                  {cell(d.legends > 0, String(d.legends), "/admin/shifts")}
                  {cell(d.staff > d.managers, String(d.staff), href("/admin/employees", { dept: d.id }))}
                  {cell(d.logins > 0 && d.loginsActive === d.logins, d.logins ? t("progress.activeOf", { n: d.loginsActive, of: d.logins }) : t("progress.none"), href("/admin/employees", { dept: d.id }))}
                  {cell(d.published, d.published ? t("progress.published") : d.scheduled ? t("progress.notPublished") : t("progress.none"), href("/schedule", { dept: d.id }))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
