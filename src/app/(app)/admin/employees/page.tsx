import Link from "next/link";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { departments, employeeRates, employees, user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { formatEur } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createEmployee } from "./actions";
import { getTranslations } from "next-intl/server";

export default async function EmployeesPage({ searchParams }: PageProps<"/admin/employees">) {
  await requireUser(["admin", "top_manager"]);
  const t = await getTranslations();
  const { dept, inactive } = (await searchParams) as { dept?: string; inactive?: string };
  const today = todayISO();

  const filters: SQL[] = [];
  if (dept) filters.push(eq(employees.departmentId, dept));
  if (!inactive) filters.push(eq(employees.active, true));

  const [deps, rows] = await Promise.all([
    db.select().from(departments).where(eq(departments.active, true)).orderBy(asc(departments.name)),
    db
      .select({
        id: employees.id,
        name: sql<string>`${employees.lastName} || ' ' || ${employees.firstName}`,
        employeeNo: employees.employeeNo,
        position: employees.position,
        active: employees.active,
        department: departments.name,
        username: user.username,
        rate: sql<number | null>`(select ${employeeRates.hourlyRateCents} from ${employeeRates}
          where ${employeeRates.employeeId} = ${employees.id} and ${employeeRates.effectiveFrom} <= ${today}
          order by ${employeeRates.effectiveFrom} desc, ${employeeRates.createdAt} desc limit 1)`,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(user, eq(user.id, employees.userId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(departments.name), asc(employees.lastName)),
  ]);

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="page-title">{t("employees.title")}</h1>

      <details className="card">
        <summary className="cursor-pointer font-medium">{t("employees.addToggle")}</summary>
        <ActionForm action={createEmployee} resetOnSuccess className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">{t("common.firstName")}</label>
            <input name="firstName" className="input" required />
          </div>
          <div>
            <label className="label">{t("common.lastName")}</label>
            <input name="lastName" className="input" required />
          </div>
          <div>
            <label className="label">{t("common.department")}</label>
            <select name="departmentId" className="input" required defaultValue={dept ?? ""}>
              <option value="" disabled>{t("common.choose")}</option>
              {deps.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t("common.position")}</label>
            <input name="position" className="input" />
          </div>
          <div>
            <label className="label">{t("common.employeeNo")}</label>
            <input name="employeeNo" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">{t("employees.hourlyRate")}</label>
              <input name="hourlyRate" className="input" inputMode="decimal" placeholder="7.50" required />
            </div>
            <div>
              <label className="label">{t("employees.rateFrom")}</label>
              <input name="effectiveFrom" type="date" className="input" defaultValue={today} required />
            </div>
          </div>
          <div>
            <label className="label">{t("employees.usernameOptional")}</label>
            <input name="username" className="input" autoCapitalize="none" placeholder="ivan.petrov" />
          </div>
          <div>
            <label className="label">{t("employees.passwordIfUsername")}</label>
            <input name="password" className="input" autoComplete="new-password" />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="canViewDepartment" /> {t("employees.canViewDepartment")}
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <SubmitButton>{t("employees.add")}</SubmitButton>
          </div>
        </ActionForm>
      </details>

      <form className="flex flex-wrap items-center gap-3 text-sm">
        <select name="dept" defaultValue={dept ?? ""} className="input w-auto">
          <option value="">{t("common.allDepartments")}</option>
          {deps.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="inactive" value="1" defaultChecked={!!inactive} /> {t("employees.showInactive")}
        </label>
        <button className="btn">{t("common.filter")}</button>
      </form>

      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="table">
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("common.department")}</th>
              <th>{t("common.position")}</th>
              <th>{t("common.employeeNo")}</th>
              <th className="text-right">{t("employees.ratePerHour")}</th>
              <th>{t("employees.login")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={e.active ? "" : "text-gray-400"}>
                <td>
                  <Link href={`/admin/employees/${e.id}`} className="font-medium text-blue-700 hover:underline">
                    {e.name}
                  </Link>
                  {!e.active && <span className="badge ml-2">{t("common.inactive")}</span>}
                </td>
                <td>{e.department}</td>
                <td>{e.position}</td>
                <td>{e.employeeNo}</td>
                <td className="text-right tabular-nums">{e.rate !== null ? formatEur(e.rate) : "—"}</td>
                <td className="text-gray-500">{e.username ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-gray-500">{t("employees.none")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
