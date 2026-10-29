import type en from "../../messages/en.json";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { hideChecklist } from "@/app/actions/guide";
import { href } from "@/lib/href";
import { getVisibleDepartments, type CurrentUser } from "@/lib/session";
import { departmentProgress, hasChannel, hotelProgress } from "@/lib/setup-status";
import { getSetting } from "@/lib/settings";
import { ActionButton } from "@/components/action-button";

type StepKey = keyof (typeof en)["checklist"]["step"];
type Step = { key: StepKey; done: boolean; href: string; optional?: boolean; count?: string };

/**
 * "Getting started": the steps this role has to do, in order, each with why it matters and a link.
 * Ticks itself from what is in the database; can be hidden.
 */
export async function SetupChecklist({ user }: { user: CurrentUser }) {
  const t = await getTranslations("checklist");
  if ((await getSetting(`checklist_hidden:${user.id}`)) === "1") return null;

  let title = t("title");
  let steps: Step[] = [];
  if (user.role === "owner" || user.role === "admin" || user.role === "top_manager") {
    const h = await hotelProgress();
    const gm = user.role === "top_manager";
    steps = [
      ...(gm ? [] : [{ key: "hotel" as const, done: h.hotelName, href: "/admin/hotel" }, { key: "gm" as const, done: h.gm, href: "/admin/users" }]),
      { key: "departments", done: h.departments > 0, href: "/admin/departments" },
      { key: "managers", done: h.departments > 0 && h.departmentsWithManager === h.departments, href: "/admin/departments", count: `${h.departmentsWithManager}/${h.departments}` },
      { key: "deptSetup", done: h.departments > 0 && h.departmentsReady === h.departments, href: "/admin/progress", count: `${h.departmentsReady}/${h.departments}` },
      { key: "budgets", done: h.departments > 0 && h.budgets === h.departments, href: "/admin/budgets", count: `${h.budgets}/${h.departments}` },
      { key: "accountant", done: h.accountant, href: "/admin/users", optional: true },
      ...(gm ? [] : [{ key: "notifications" as const, done: h.notifications, href: "/admin/notifications", optional: true }]),
    ];
  } else if (user.role === "manager") {
    const deps = await getVisibleDepartments(user);
    const progress = await departmentProgress(deps.map((d) => d.id));
    // The first department that isn't finished (most managers have one).
    const p = progress.find((d) => !(d.locations && d.roles && d.needs && d.staff > 1 && d.loginsActive && d.published)) ?? progress[0];
    if (!p) return null;
    title = t("titleDept", { name: p.name });
    steps = [
      { key: "locations", done: p.locations > 0, href: href("/setup", { dept: p.id }) },
      { key: "roles", done: p.roles > 0, href: href("/setup", { dept: p.id }) },
      { key: "needs", done: p.needs > 0, href: href("/needs", { dept: p.id }) },
      { key: "legends", done: p.legends > 0, href: "/admin/shifts" },
      { key: "staff", done: p.staff > 1, href: href("/admin/employees", { dept: p.id }), count: String(p.staff) },
      { key: "logins", done: p.logins > 0 && p.loginsActive === p.logins, href: href("/admin/employees", { dept: p.id }), count: `${p.loginsActive}/${p.logins}` },
      { key: "schedule", done: p.scheduled, href: href("/schedule", { dept: p.id }) },
      { key: "publish", done: p.published, href: href("/schedule", { dept: p.id }) },
    ];
  } else if (user.role === "accountant") {
    steps = [
      { key: "channel", done: await hasChannel(user.id), href: "/account" },
      { key: "exports", done: false, href: "/timesheet/month", optional: true },
      { key: "roleHours", done: false, href: "/timesheet/roles", optional: true },
      { key: "advances", done: false, href: "/advances", optional: true },
    ];
  } else return null;

  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done);
  const allDone = done === required.length;

  return (
    <section className="card space-y-3 border-blue-200" aria-label={title}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">{allDone ? t("allDone") : title}</h2>
        <span className="badge bg-blue-50 text-blue-700">{t("progress", { done, total: required.length })}</span>
        <span className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-gray-100">
          <span className="block h-full bg-blue-600" style={{ width: `${(done / Math.max(1, required.length)) * 100}%` }} />
        </span>
        <ActionButton action={hideChecklist} args={[]} className="btn btn-sm">
          {t("hide")}
        </ActionButton>
      </div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.key} className={`flex items-start gap-3 rounded-lg px-2 py-1.5 ${s === next ? "bg-blue-50" : ""}`}>
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-green-600 text-white" : "border border-gray-300 text-gray-500"}`}
              aria-label={s.done ? t("done") : t("todo")}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span className="min-w-0 flex-1 text-sm">
              <Link href={s.href} className={`font-medium hover:underline ${s.done ? "text-gray-500" : "text-blue-700"}`}>
                {t(`step.${s.key}.title`)}
              </Link>
              {s.count && <span className="ml-2 text-xs text-gray-500 tabular-nums">{s.count}</span>}
              {s.optional && <span className="ml-2 text-xs text-gray-400">{t("optional")}</span>}
              {!s.done && <span className="block text-xs text-gray-600">{t(`step.${s.key}.why`)}</span>}
            </span>
            {s === next && (
              <Link href={s.href} className="btn btn-primary btn-sm shrink-0">
                {t("start")}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
