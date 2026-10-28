import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { departments } from "@/db/schema";
import { getEmployeeForUser, requireUser } from "@/lib/session";

export default async function MePage() {
  const user = await requireUser();
  const emp = await getEmployeeForUser(user.id);
  const dept = emp ? await db.query.departments.findFirst({ where: eq(departments.id, emp.departmentId) }) : null;

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="page-title">Hello, {user.name.split(" ")[0]}</h1>
      {emp ? (
        <div className="card text-sm">
          <div className="text-gray-500">Department</div>
          <div className="font-medium">{dept?.name}</div>
          {emp.position && <div className="mt-2 text-gray-500">{emp.position}</div>}
        </div>
      ) : (
        <p className="text-sm text-gray-500">Your login is not linked to an employee record.</p>
      )}
      <p className="text-sm text-gray-500">Your schedule appears here in Phase 2; hours and estimated pay in Phase 5.</p>
    </div>
  );
}
