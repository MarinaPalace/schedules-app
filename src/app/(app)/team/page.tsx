import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/db/client";
import { employees, user } from "@/db/schema";
import { monthOf } from "@/lib/calendar";
import { computeMonth } from "@/lib/costs";
import { key, loadSchedule, loadShiftTemplates } from "@/lib/data";
import { getDayLabels } from "@/lib/day-labels";
import { describeDay } from "@/lib/describe";
import { todayISO } from "@/lib/dates";
import { getVisibleDepartments, requireUser, STAFF_EDITORS, type Role } from "@/lib/session";
import { formatHours } from "@/lib/shifts";
import { LinkTabs, href } from "@/components/toolbar";

export default async function TeamPage({ searchParams }: PageProps<"/team">) {
  const me = await requireUser(["manager", "top_manager", "owner", "admin"]);
  const sp = (await searchParams) as { dept?: string };
  const [t, labels] = await Promise.all([getTranslations(), getDayLabels()]);
  const deps = await getVisibleDepartments(me);
  if (!deps.length) return <p className="text-sm text-gray-500">{t("common.noDepartments")}</p>;
  const shown = sp.dept ? deps.filter((d) => d.id === sp.dept) : deps;
  const today = todayISO();
  const canEdit = STAFF_EDITORS.includes(me.role);

  const staff = await db
    .select({ e: employees, role: user.role })
    .from(employees)
    .leftJoin(user, eq(user.id, employees.userId))
    .where(and(inArray(employees.departmentId, shown.map((d) => d.id)), eq(employees.active, true)))
    .orderBy(asc(employees.lastName), asc(employees.firstName));
  const [plan, month, templates] = await Promise.all([
    loadSchedule(staff.map((s) => s.e.id), today, today),
    computeMonth(shown.map((d) => d.id), monthOf(today)),
    loadShiftTemplates(),
  ]);
  const hours = new Map<string, { approved: number; planned: number }>();
  for (const m of month.values()) {
    for (const e of m.employees) {
      const h = hours.get(e.employeeId) ?? { approved: 0, planned: 0 };
      hours.set(e.employeeId, { approved: h.approved + e.approvedMinutes, planned: h.planned + e.plannedMinutes });
    }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-2">{t("team.title")}</h1>
        {deps.length > 1 && (
          <LinkTabs
            base="/team"
            params={{}}
            name="dept"
            value={sp.dept ?? ""}
            options={[{ value: "", label: t("common.allDepartments") }, ...deps.map((d) => ({ value: d.id, label: d.name }))]}
          />
        )}
      </div>

      {shown.map((d) => {
        const people = staff.filter((s) => s.e.departmentId === d.id);
        return (
          <section key={d.id} className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-600">
              {d.name} · {t("team.count", { count: people.length })}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {people.map(({ e, role }) => {
                const p = plan.get(key(e.id, today));
                const tpl = p?.shiftTemplateId ? templates.find((x) => x.id === p.shiftTemplateId) : null;
                const h = hours.get(e.id) ?? { approved: 0, planned: 0 };
                return (
                  <div key={e.id} className="card flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">
                          {e.lastName} {e.firstName}
                        </div>
                        <div className="text-sm text-gray-500">
                          {e.position}
                          {role && role !== "employee" && <span className="badge ml-2">{t(`roles.${role as Role}`)}</span>}
                        </div>
                      </div>
                      {e.phone && (
                        <a href={`tel:${e.phone.replace(/\s/g, "")}`} className="btn btn-sm shrink-0" aria-label={t("team.call")}>
                          📞 {t("team.call")}
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">{t("common.today")}:</span>
                      {tpl && p?.kind === "shift" && (
                        <span className="rounded px-1.5 py-0.5 text-xs font-semibold text-white" style={{ background: tpl.color }}>
                          {tpl.code}
                        </span>
                      )}
                      <span>{p && p.kind !== "none" ? describeDay(p, labels) : <span className="text-gray-400">{t("me.notPlanned")}</span>}</span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {t("team.monthHours", { approved: formatHours(h.approved), planned: formatHours(h.planned) })}
                    </div>
                    <div className="mt-auto flex gap-2">
                      <Link href={href("/schedule", { dept: d.id, view: "month", person: e.id })} className="btn btn-sm flex-1">
                        {t("team.schedule")}
                      </Link>
                      {canEdit && (
                        <Link href={`/admin/employees/${e.id}`} className="btn btn-sm flex-1">
                          {t("team.edit")}
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
              {people.length === 0 && <p className="text-sm text-gray-500">{t("employees.none")}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
