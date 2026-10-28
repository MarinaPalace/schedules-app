import {
  bigserial,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

/** One continuous working block, "HH:MM". If end <= start the block ends the next day. */
export type Segment = { start: string; end: string };

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const createdBy = () => text("created_by").references(() => user.id);

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const departmentManagers = pgTable(
  "department_managers",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.departmentId] })],
);

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .unique()
    .references(() => user.id),
  employeeNo: text("employee_no").unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  position: text("position"),
  phone: text("phone"),
  departmentId: uuid("department_id")
    .notNull()
    .references(() => departments.id),
  canViewDepartment: boolean("can_view_department").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Append-only. The row with the latest effective_from <= date applies. */
export const employeeRates = pgTable(
  "employee_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    hourlyRateCents: integer("hourly_rate_cents").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("employee_rates_emp_idx").on(t.employeeId, t.effectiveFrom)],
);

export const shiftTemplates = pgTable("shift_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  segments: jsonb("segments").$type<Segment[]>().notNull(),
  /** Unpaid break inside the segments, in minutes. */
  breakMinutes: integer("break_minutes").notNull().default(0),
  paidMinutes: integer("paid_minutes").notNull(),
  /** null = available to all departments */
  departmentId: uuid("department_id").references(() => departments.id),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Append-only. The latest row per (employee, work_date) is the current plan. */
export const scheduleEntries = pgTable(
  "schedule_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    workDate: date("work_date").notNull(),
    /** shift | off | absence */
    kind: text("kind").notNull(),
    shiftTemplateId: uuid("shift_template_id").references(() => shiftTemplates.id),
    absenceCode: text("absence_code"),
    segments: jsonb("segments").$type<Segment[]>().notNull().default([]),
    breakMinutes: integer("break_minutes").notNull().default(0),
    paidMinutes: integer("paid_minutes").notNull().default(0),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    note: text("note"),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("schedule_entries_lookup_idx").on(t.employeeId, t.workDate, t.createdAt)],
);

/** Append-only. Employees see a day as it was at the latest publication covering it. */
export const schedulePublications = pgTable(
  "schedule_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("schedule_publications_dept_idx").on(t.departmentId, t.fromDate, t.toDate)],
);

/** Forma 76 — approved actual hours. Append-only; highest version per (employee, work_date) is current. */
export const timesheetEntries = pgTable(
  "timesheet_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    workDate: date("work_date").notNull(),
    version: integer("version").notNull(),
    kind: text("kind").notNull(),
    absenceCode: text("absence_code"),
    segments: jsonb("segments").$type<Segment[]>().notNull().default([]),
    breakMinutes: integer("break_minutes").notNull().default(0),
    paidMinutes: integer("paid_minutes").notNull().default(0),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    /** Set when this version came from an approved correction. */
    correctionRequestId: uuid("correction_request_id"),
    note: text("note"),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("timesheet_entries_version_uq").on(t.employeeId, t.workDate, t.version)],
);

export const correctionRequests = pgTable("correction_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  workDate: date("work_date").notNull(),
  baseTimesheetId: uuid("base_timesheet_id")
    .notNull()
    .references(() => timesheetEntries.id),
  /** Unpaid break inside the segments, in minutes. */
  breakMinutes: integer("break_minutes").notNull().default(0),
  kind: text("kind").notNull(),
  absenceCode: text("absence_code"),
  segments: jsonb("segments").$type<Segment[]>().notNull().default([]),
  paidMinutes: integer("paid_minutes").notNull().default(0),
  reason: text("reason").notNull(),
  createdBy: createdBy(),
  createdAt: createdAt(),
});

export const correctionDecisions = pgTable("correction_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .unique()
    .references(() => correctionRequests.id),
  /** approved | rejected */
  decision: text("decision").notNull(),
  note: text("note"),
  createdBy: createdBy(),
  createdAt: createdAt(),
});

/** Append-only. Latest row per (department, month) is the budget. */
export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  departmentId: uuid("department_id")
    .notNull()
    .references(() => departments.id),
  /** First day of the month. */
  month: date("month").notNull(),
  amountCents: integer("amount_cents").notNull(),
  hours: integer("hours"),
  createdBy: createdBy(),
  createdAt: createdAt(),
});

export const advanceRequests = pgTable("advance_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  amountCents: integer("amount_cents").notNull(),
  note: text("note"),
  createdBy: createdBy(),
  createdAt: createdAt(),
});

export const advanceDecisions = pgTable("advance_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .unique()
    .references(() => advanceRequests.id),
  decision: text("decision").notNull(),
  note: text("note"),
  createdBy: createdBy(),
  createdAt: createdAt(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Written only by DB triggers. */
export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorId: text("actor_id"),
  tableName: text("table_name").notNull(),
  operation: text("operation").notNull(),
  rowId: text("row_id"),
  oldData: jsonb("old_data"),
  newData: jsonb("new_data"),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
});
