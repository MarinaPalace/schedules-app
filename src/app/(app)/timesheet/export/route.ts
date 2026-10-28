import { getTranslations } from "next-intl/server";
import { isMonth } from "@/lib/calendar";
import { ABSENCE_CODES } from "@/lib/codes";
import { getDayLabels } from "@/lib/day-labels";
import { buildMonthSheet } from "@/lib/month-sheet";
import { getCurrentUser, getVisibleDepartments } from "@/lib/session";

// Semicolon + decimal comma + BOM: opens correctly in Excel with Bulgarian regional settings.
const SEP = ";";
const num = (minutes: number) => (minutes / 60).toFixed(2).replace(".", ",");
const cell = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role === "employee") return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const deptId = url.searchParams.get("dept");
  const month = url.searchParams.get("month");
  const dept = (await getVisibleDepartments(user)).find((d) => d.id === deptId);
  if (!dept || !isMonth(month)) return new Response("Not found", { status: 404 });

  const [t, labels] = await Promise.all([getTranslations(), getDayLabels()]);
  const { dates, rows } = await buildMonthSheet(dept.id, month, labels, (text) => text);
  const header = [
    t("common.employeeNo"),
    t("common.name"),
    t("common.position"),
    ...dates.map((d) => d.slice(8)),
    t("timesheet.approvedH"),
    t("timesheet.notApprovedH"),
    ...ABSENCE_CODES,
  ];
  const lines = [
    [`${t("timesheet.title")} – ${dept.name} – ${month}`],
    header,
    ...rows.map((r) => [
      r.employeeNo ?? "",
      r.name,
      r.position ?? "",
      ...r.cells.map((c) => (c.approved ? c.text.replace(".", ",") : c.text ? `(${c.text.replace(".", ",")})` : "")),
      num(r.approvedMinutes),
      num(r.plannedMinutes),
      ...ABSENCE_CODES.map((code) => String(r.absences[code] || "")),
    ]),
  ];
  const csv = "﻿" + lines.map((l) => l.map(cell).join(SEP)).join("\r\n");
  const filename = `forma76-${dept.name.replace(/[^\w-]+/g, "_")}-${month}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
