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

/**
 * One continuous working block, "HH:MM". If end <= start the block ends the next day.
 * `locationId`: where the block is worked (restaurant, bar…); blocks of one shift may be at different places.
 */
export type Segment = { start: string; end: string; locationId?: string | null };

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

/** What people do in a department (Waiter, Helper waiter, Assistant manager…); used to count staff per role. */
export const jobRoles = pgTable("job_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  departmentId: uuid("department_id")
    .notNull()
    .references(() => departments.id),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Places inside a department (Restaurant 1, Lobby bar…); each has its own schedule. */
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    name: text("name").notNull(),
    /** Short code shown in grids, e.g. "R1", "B3". */
    code: text("code").notNull(),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("locations_dept_code_uq").on(t.departmentId, t.code)],
);

/** Hotel-wide named periods (e.g. High season 01.06–30.09) that staffing needs can be set for. */
export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: createdBy(),
  createdAt: createdAt(),
});

/**
 * Append-only. How many people of each role a location needs, for one scope:
 * a set of weekdays (bit 0 = Monday … bit 6 = Sunday), all year or within a season, or one date.
 * The latest plan per (location, scope) is the current one; an empty plan removes the rule.
 */
export const staffingPlans = pgTable(
  "staffing_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    weekdays: integer("weekdays").notNull().default(127),
    seasonId: uuid("season_id").references(() => seasons.id),
    onDate: date("on_date"),
    note: text("note"),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("staffing_plans_location_idx").on(t.locationId, t.createdAt)],
);

export const staffingPlanRows = pgTable("staffing_plan_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => staffingPlans.id),
  fromTime: text("from_time").notNull(),
  toTime: text("to_time").notNull(),
  roleId: uuid("role_id")
    .notNull()
    .references(() => jobRoles.id),
  count: integer("count").notNull(),
});

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
  /** Unused since every employee may see their department's published schedule (kept: columns are never dropped). */
  canViewDepartment: boolean("can_view_department").notNull().default(false),
  /** Usual role and place – filled in when planning, can be changed per shift. */
  jobRoleId: uuid("job_role_id").references(() => jobRoles.id),
  homeLocationId: uuid("home_location_id").references(() => locations.id),
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
    /** Set when this row came from an approved shift swap; such rows are visible to employees without publishing. */
    swapRequestId: uuid("swap_request_id"),
    /** Role worked in this shift (the employee's usual role unless changed for the day). */
    jobRoleId: uuid("job_role_id").references(() => jobRoles.id),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("schedule_entries_lookup_idx").on(t.employeeId, t.workDate, t.createdAt)],
);

/**
 * Append-only. Two employees of one department exchange their planned days:
 * on `date1` (and `date2`, if set) each gets the other's published plan.
 * `snapshot` holds the schedule_entries id (or null) per "employeeId|date" as published when requested.
 */
export const swapRequests = pgTable(
  "swap_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => employees.id),
    colleagueId: uuid("colleague_id")
      .notNull()
      .references(() => employees.id),
    date1: date("date1").notNull(),
    date2: date("date2"),
    snapshot: jsonb("snapshot").$type<Record<string, string | null>>().notNull(),
    note: text("note"),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("swap_requests_dept_idx").on(t.departmentId, t.createdAt)],
);

/** Append-only. The latest event of a swap request is its state: accepted → waiting for the manager. */
export const swapEvents = pgTable(
  "swap_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => swapRequests.id),
    /** accepted | declined | cancelled | approved | rejected */
    action: text("action").notNull(),
    note: text("note"),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("swap_events_request_idx").on(t.requestId, t.createdAt)],
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
    /** Role worked (from the schedule), so hours per role can be reported for pay. */
    jobRoleId: uuid("job_role_id").references(() => jobRoles.id),
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

/** Append-only. Accounting marks an approved advance as handed out. */
export const advancePayments = pgTable("advance_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .unique()
    .references(() => advanceRequests.id),
  note: text("note"),
  createdBy: createdBy(),
  createdAt: createdAt(),
});

/**
 * One-time links: `setup` (first password), `reset` (forgotten password), `telegram` (connect a chat).
 * Only a SHA-256 hash of the token is stored.
 */
export const loginTokens = pgTable(
  "login_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("login_tokens_user_idx").on(t.userId, t.purpose, t.createdAt)],
);

/** Delivery log of email/Telegram messages. Links with tokens are redacted before storing. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id),
    /** email | telegram */
    channel: text("channel").notNull(),
    recipient: text("recipient").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    /** sent | failed | not_configured */
    status: text("status").notNull(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_created_idx").on(t.createdAt)],
);

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
