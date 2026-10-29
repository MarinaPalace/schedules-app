import "server-only";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { correctionDecisions, correctionRequests, employees } from "@/db/schema";
import { loadAdvances } from "@/lib/advances";
import { getEmployeeForUser, getVisibleDepartments, MANAGES, type CurrentUser } from "@/lib/session";
import { loadSwaps } from "@/lib/swaps";

export type Badges = Partial<Record<"mySchedule" | "swaps" | "corrections" | "advances", number>>;

/** Things waiting for this user's action, shown as counters in the navigation. */
export async function loadBadges(user: CurrentUser): Promise<Badges> {
  const [deptIds, emp] = await Promise.all([getVisibleDepartments(user).then((d) => d.map((x) => x.id)), getEmployeeForUser(user.id)]);
  const decidesAdvances = MANAGES.includes(user.role) || user.role === "accountant";
  const givesAdvances = user.role === "accountant" || user.role === "admin";

  const [mine, deptSwaps, corrections, advances] = await Promise.all([
    emp ? loadSwaps({ employeeId: emp.id, limit: 50 }) : [],
    MANAGES.includes(user.role) ? loadSwaps({ departmentIds: deptIds }) : [],
    user.role === "top_manager" || user.role === "admin"
      ? db
          .select({ n: count() })
          .from(correctionRequests)
          .innerJoin(employees, eq(employees.id, correctionRequests.employeeId))
          .leftJoin(correctionDecisions, eq(correctionDecisions.requestId, correctionRequests.id))
          .where(and(isNull(correctionDecisions.id), inArray(employees.departmentId, deptIds.length ? deptIds : ["00000000-0000-0000-0000-000000000000"])))
      : [],
    decidesAdvances ? loadAdvances({ departmentIds: deptIds }) : [],
  ]);

  return {
    mySchedule: mine.filter((s) => s.status === "waiting_colleague" && s.colleague.id === emp?.id).length,
    swaps: deptSwaps.filter((s) => s.status === "waiting_manager" && s.requester.userId !== user.id && s.colleague.userId !== user.id).length,
    corrections: corrections[0]?.n ?? 0,
    advances: advances.filter((a) => (!a.decision && a.employeeUserId !== user.id) || (givesAdvances && a.decision === "approved" && !a.givenAt)).length,
  };
}
