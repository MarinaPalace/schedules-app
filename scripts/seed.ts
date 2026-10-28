import { config } from "dotenv";
import type { Segment } from "../src/db/schema";
config({ path: ".env.local" });

// Demo data. Safe to run once on an empty database.
async function main() {
  const { db } = await import("../src/db/client");
  const { withActor } = await import("../src/lib/actor");
  const { createLogin } = await import("../src/lib/users");
  const { paidMinutes } = await import("../src/lib/shifts");
  const s = await import("../src/db/schema");

  const existing = await db.select().from(s.departments).limit(1);
  if (existing.length) {
    console.log("Database already has data; skipping seed.");
    process.exit(0);
  }

  const PASSWORD = "demo1234";
  const adminId = await db.transaction((tx) =>
    createLogin(tx, { username: "admin", name: "System Admin", password: PASSWORD, role: "admin" }),
  );

  await withActor(adminId, async (tx) => {
    const [fo, hk, fb] = await tx
      .insert(s.departments)
      .values([{ name: "Front Office" }, { name: "Housekeeping" }, { name: "F&B / Bar" }])
      .returning();

    await createLogin(tx, { username: "owner", name: "Hotel Owner", password: PASSWORD, role: "owner" });
    await createLogin(tx, { username: "topmanager", name: "General Manager", password: PASSWORD, role: "top_manager" });
    await createLogin(tx, { username: "accountant", name: "Accounting", password: PASSWORD, role: "accountant" });
    const mFo = await createLogin(tx, { username: "manager.fo", name: "Maria Georgieva", password: PASSWORD, role: "manager" });
    const mHk = await createLogin(tx, { username: "manager.hk", name: "Elena Dimitrova", password: PASSWORD, role: "manager" });
    await tx.insert(s.departmentManagers).values([
      { userId: mFo, departmentId: fo.id },
      { userId: mHk, departmentId: hk.id },
      { userId: mHk, departmentId: fb.id },
    ]);

    const staff: Array<[string, string, string, string, number, boolean]> = [
      // first, last, position, dept, hourly rate (cents), has login
      ["Ivan", "Petrov", "Receptionist", fo.id, 750, true],
      ["Georgi", "Ivanov", "Receptionist", fo.id, 750, false],
      ["Nikolay", "Stoyanov", "Night auditor", fo.id, 820, false],
      ["Desislava", "Koleva", "Concierge", fo.id, 700, false],
      ["Petya", "Todorova", "Maid", hk.id, 560, true],
      ["Radka", "Angelova", "Maid", hk.id, 560, false],
      ["Silvia", "Marinova", "Maid", hk.id, 560, false],
      ["Vesela", "Hristova", "Laundry", hk.id, 540, false],
      ["Stefan", "Nikolov", "Bartender", fb.id, 680, false],
      ["Kalina", "Popova", "Waitress", fb.id, 620, false],
      ["Martin", "Iliev", "Cook", fb.id, 850, false],
    ];
    let no = 1001;
    for (const [first, last, position, departmentId, rate, hasLogin] of staff) {
      const userId = hasLogin
        ? await createLogin(tx, {
            username: `${first}.${last}`.toLowerCase(),
            name: `${first} ${last}`,
            password: PASSWORD,
            role: "employee",
          })
        : null;
      const [emp] = await tx
        .insert(s.employees)
        .values({ firstName: first, lastName: last, position, departmentId, userId, employeeNo: String(no++), canViewDepartment: hasLogin })
        .returning();
      await tx.insert(s.employeeRates).values({ employeeId: emp.id, hourlyRateCents: rate, effectiveFrom: "2026-01-01", createdBy: adminId });
    }

    const templates: Array<[string, string, string, Segment[], number]> = [
      ["M", "Morning", "#f59e0b", [{ start: "07:00", end: "15:00" }], 0],
      ["A", "Afternoon", "#3b82f6", [{ start: "15:00", end: "23:00" }], 0],
      ["N", "Night", "#6366f1", [{ start: "23:00", end: "07:00" }], 0],
      ["S1", "Split", "#10b981", [{ start: "09:00", end: "11:00" }, { start: "15:00", end: "20:00" }], 0],
      ["HK", "Housekeeping day", "#ec4899", [{ start: "08:00", end: "16:30" }], 30],
    ];
    await tx.insert(s.shiftTemplates).values(
      templates.map(([code, name, color, segments, breakMinutes]) => ({
        code,
        name,
        color,
        segments,
        breakMinutes,
        paidMinutes: paidMinutes(segments, breakMinutes),
      })),
    );
  });

  console.log(`Seed done. All demo users have password "${PASSWORD}".`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
