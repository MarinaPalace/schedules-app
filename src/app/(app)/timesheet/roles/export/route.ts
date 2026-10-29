import { getTranslations } from "next-intl/server";
import { isMonth } from "@/lib/calendar";
import { buildRoleHours } from "@/lib/role-hours";
import { getCurrentUser, getVisibleDepartments } from "@/lib/session";

// Same format as the Forma 76 export: semicolon + decimal comma + BOM (opens in Bulgarian Excel).
const SEP = ";";
const num = (minutes?: number) => (minutes ? (minutes / 60).toFixed(2).replace(".", ",") : "");
const cell = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Approved hours per role per person (planned, not yet approved hours in their own columns). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role === "employee") return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const dept = (await getVisibleDepartments(user)).find((d) => d.id === url.searchParams.get("dept"));
  if (!dept || !isMonth(month)) return new Response("Not found", { status: 404 });

  const t = await getTranslations();
  const { rows, columns, roles } = await buildRoleHours(dept.id, month);
  const name = (id: string | null) => (id ? (roles.find((r) => r.id === id)?.name ?? "") : t("roleHours.noRole"));
  const header = [
    t("common.employeeNo"),
    t("common.name"),
    t("roleHours.mainRole"),
    ...columns.map((c) => name(c.id || null)),
    t("roleHours.other"),
    ...columns.map((c) => `${name(c.id || null)} – ${t("roleHours.plannedCol")}`),
  ];
  const lines = [
    [`${t("roleHours.title")} – ${dept.name} – ${month}`],
    header,
    ...rows.map((r) => [
      r.employeeNo ?? "",
      r.name,
      name(r.mainRoleId),
      ...columns.map((c) => num(r.approved[c.id])),
      num(r.otherApproved),
      ...columns.map((c) => num(r.planned[c.id])),
    ]),
  ];
  const csv = "﻿" + lines.map((l) => l.map(cell).join(SEP)).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hours-by-role-${month}.csv"`,
    },
  });
}
