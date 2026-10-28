import "server-only";
import { dateRange, monthBounds } from "@/lib/calendar";
import { ABSENCE_CODES, type DayLabels } from "@/lib/codes";
import { key, loadDepartmentEmployees, loadSchedule, loadTimesheet } from "@/lib/data";
import { describeDay } from "@/lib/describe";
import { formatHours } from "@/lib/shifts";

export type SheetCell = { text: string; approved: boolean; minutes: number; title: string };
export type SheetRow = {
  employeeId: string;
  employeeNo: string | null;
  name: string;
  position: string | null;
  cells: SheetCell[];
  approvedMinutes: number;
  plannedMinutes: number;
  absences: Record<string, number>;
};

/** Forma 76 month grid: approved values, with not-yet-approved plan shown in brackets. */
export async function buildMonthSheet(departmentId: string, month: string, labels: DayLabels, plannedTitle: (text: string) => string) {
  const { from, to } = monthBounds(month);
  const dates = dateRange(from, to);
  const employees = await loadDepartmentEmployees(departmentId, from, to);
  const ids = employees.map((e) => e.id);
  const [schedule, timesheet] = await Promise.all([loadSchedule(ids, from, to), loadTimesheet(ids, from, to)]);

  const rows: SheetRow[] = employees.map((e) => {
    const row: SheetRow = {
      employeeId: e.id,
      employeeNo: e.employeeNo,
      name: `${e.lastName} ${e.firstName}`,
      position: e.position,
      cells: [],
      approvedMinutes: 0,
      plannedMinutes: 0,
      absences: Object.fromEntries(ABSENCE_CODES.map((c) => [c, 0])),
    };
    for (const d of dates) {
      const ts = timesheet.get(key(e.id, d));
      const sc = schedule.get(key(e.id, d));
      // Rows that belong to another department that day are left blank here.
      if (ts && ts.departmentId === departmentId) {
        row.approvedMinutes += ts.paidMinutes;
        if (ts.kind === "absence" && ts.absenceCode) row.absences[ts.absenceCode] = (row.absences[ts.absenceCode] ?? 0) + 1;
        row.cells.push({
          text: ts.kind === "shift" ? formatHours(ts.paidMinutes) : ts.kind === "absence" ? ts.absenceCode ?? "" : ts.kind === "off" ? "–" : "",
          approved: true,
          minutes: ts.paidMinutes,
          title: describeDay(ts, labels) + (ts.version > 1 ? ` (v${ts.version})` : ""),
        });
      } else if (!ts && sc && sc.departmentId === departmentId && sc.kind !== "none") {
        row.plannedMinutes += sc.paidMinutes;
        row.cells.push({
          text: sc.kind === "shift" ? formatHours(sc.paidMinutes) : sc.kind === "absence" ? sc.absenceCode ?? "" : "–",
          approved: false,
          minutes: sc.paidMinutes,
          title: plannedTitle(describeDay(sc, labels)),
        });
      } else {
        row.cells.push({ text: "", approved: false, minutes: 0, title: "" });
      }
    }
    return row;
  });
  return { dates, rows };
}
