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
  const { and, eq } = await import("drizzle-orm");

  const extendLastByHour = (segs: Segment[]): Segment[] =>
    segs.map((x, j) => (j === segs.length - 1 ? { ...x, end: `${String((Number(x.end.slice(0, 2)) + 1) % 24).padStart(2, "0")}${x.end.slice(2)}` } : x));

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
    const shifts = await tx
      .insert(s.shiftTemplates)
      .values(
        templates.map(([code, name, color, segments, breakMinutes]) => ({
          code,
          name,
          color,
          segments,
          breakMinutes,
          paidMinutes: paidMinutes(segments, breakMinutes),
        })),
      )
      .returning();
    const byCode = Object.fromEntries(shifts.map((t) => [t.code, t]));

    // A month of demo schedule: rotating patterns per department.
    const { todayISO } = await import("../src/lib/dates");
    const { monthBounds, monthOf, dateRange } = await import("../src/lib/calendar");
    const today = todayISO();
    const month = monthOf(today);
    const { from, to } = monthBounds(month);
    const allEmployees = await tx.select().from(s.employees);
    const patterns: Record<string, (string | null)[]> = {
      [fo.id]: ["M", "M", "A", "A", "N", null, null],
      [hk.id]: ["HK", "HK", "HK", "HK", "HK", null, null],
      [fb.id]: ["S1", "S1", "A", "A", null, "S1", null],
    };
    const scheduleRows = [];
    const timesheetRows = [];
    for (const [i, emp] of allEmployees.entries()) {
      const pattern = patterns[emp.departmentId];
      for (const [d, date] of dateRange(from, to).entries()) {
        const code = pattern[(d + i * 2) % 7];
        const t = code ? byCode[code] : null;
        const row = {
          employeeId: emp.id,
          workDate: date,
          kind: t ? "shift" : "off",
          shiftTemplateId: t?.id ?? null,
          segments: t?.segments ?? [],
          breakMinutes: t?.breakMinutes ?? 0,
          paidMinutes: t?.paidMinutes ?? 0,
          departmentId: emp.departmentId,
          createdBy: mFo,
        };
        scheduleRows.push(row);
        // Past days are approved; every 9th worked day someone stayed an hour longer.
        if (date < today) {
          const longer = t && (d + i) % 9 === 0;
          const fixedSegments = longer ? extendLastByHour(t.segments) : row.segments;
          timesheetRows.push({
            employeeId: emp.id,
            workDate: date,
            version: 1,
            kind: row.kind,
            segments: fixedSegments,
            breakMinutes: row.breakMinutes,
            paidMinutes: t ? paidMinutes(fixedSegments, row.breakMinutes) : 0,
            departmentId: emp.departmentId,
            createdBy: mFo,
          });
        }
      }
    }
    await tx.insert(s.scheduleEntries).values(scheduleRows);
    // Publish the demo month so employees can see it.
    await tx.insert(s.schedulePublications).values([fo, hk, fb].map((d) => ({ departmentId: d.id, fromDate: from, toDate: to, createdBy: mFo })));
    if (timesheetRows.length) await tx.insert(s.timesheetEntries).values(timesheetRows);

    await tx.insert(s.budgets).values([
      { departmentId: fo.id, month: `${month}-01`, amountCents: 700000, hours: 800, createdBy: adminId },
      { departmentId: hk.id, month: `${month}-01`, amountCents: 450000, hours: 700, createdBy: adminId },
      { departmentId: fb.id, month: `${month}-01`, amountCents: 425000, hours: 520, createdBy: adminId },
    ]);

    // One pending correction and one pending advance, to show the approval queues.
    const ivan = allEmployees.find((e) => e.firstName === "Ivan")!;
    const firstApproved = timesheetRows.find((r) => r.employeeId === ivan.id && r.kind === "shift");
    if (firstApproved) {
      const [base] = await tx
        .select()
        .from(s.timesheetEntries)
        .where(and(eq(s.timesheetEntries.employeeId, ivan.id), eq(s.timesheetEntries.workDate, firstApproved.workDate)));
      await tx.insert(s.correctionRequests).values({
        employeeId: ivan.id,
        workDate: base.workDate,
        baseTimesheetId: base.id,
        kind: "absence",
        absenceCode: "Б",
        segments: [],
        paidMinutes: 0,
        reason: "Brought a sick note afterwards",
        createdBy: mFo,
      });
    }
    const petya = allEmployees.find((e) => e.firstName === "Petya")!;
    await tx.insert(s.advanceRequests).values({ employeeId: petya.id, amountCents: 20000, note: "Rent", createdBy: petya.userId });
  });

  console.log(`Seed done. All demo users have password "${PASSWORD}".`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
