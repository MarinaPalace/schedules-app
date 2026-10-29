import "server-only";
import { dateRange, monthBounds } from "@/lib/calendar";
import { key, loadDepartmentEmployees, loadSchedule, loadTimesheet } from "@/lib/data";
import { loadRoles } from "@/lib/org";

export type RoleHoursRow = {
  employeeId: string;
  name: string;
  employeeNo: string | null;
  mainRoleId: string | null;
  /** Approved Forma 76 minutes per role id ("" = no role). */
  approved: Record<string, number>;
  /** Still only planned (not approved yet) minutes per role. */
  planned: Record<string, number>;
  /** Approved minutes in a role other than the main one – may be paid at another rate. */
  otherApproved: number;
  otherPlanned: number;
};

/**
 * Hours per role for a department and month: approved Forma 76 days by the role worked,
 * plus planned days not approved yet. Days in other departments are left out.
 */
export async function buildRoleHours(departmentId: string, month: string) {
  const { from, to } = monthBounds(month);
  const people = await loadDepartmentEmployees(departmentId, from, to);
  const ids = people.map((p) => p.id);
  const [timesheet, schedule, roles] = await Promise.all([loadTimesheet(ids, from, to), loadSchedule(ids, from, to), loadRoles([departmentId], true)]);
  const dates = dateRange(from, to);

  const rows: RoleHoursRow[] = people.map((p) => {
    const main = p.departmentId === departmentId ? p.jobRoleId : null;
    const r: RoleHoursRow = { employeeId: p.id, name: `${p.lastName} ${p.firstName}`, employeeNo: p.employeeNo, mainRoleId: main, approved: {}, planned: {}, otherApproved: 0, otherPlanned: 0 };
    for (const d of dates) {
      const ts = timesheet.get(key(p.id, d));
      const sc = schedule.get(key(p.id, d));
      const row = ts ?? sc;
      if (!row || row.kind !== "shift" || row.departmentId !== departmentId || !row.paidMinutes) continue;
      const role = row.jobRoleId ?? "";
      const bucket = ts ? r.approved : r.planned;
      bucket[role] = (bucket[role] ?? 0) + row.paidMinutes;
      if (role && main && role !== main) {
        if (ts) r.otherApproved += row.paidMinutes;
        else r.otherPlanned += row.paidMinutes;
      }
    }
    return r;
  });

  // Columns: roles in their order that are someone's main role or have hours, then "no role" if used.
  const used = new Set(rows.flatMap((r) => [...Object.keys(r.approved), ...Object.keys(r.planned), r.mainRoleId ?? ""]));
  const columns = [
    ...roles.filter((x) => used.has(x.id)).map((x) => ({ id: x.id, name: x.name })),
    ...(used.has("") ? [{ id: "", name: "" }] : []),
  ];
  return { rows: rows.filter((r) => Object.keys(r.approved).length || Object.keys(r.planned).length || r.mainRoleId), columns, roles };
}
