# Hotel Schedules App — Plan & Progress

Status legend: `[x]` done · `[~]` in progress / partial · `[ ]` pending

Last updated: 2026-10-28

---

## 1. Goal

A simple internal tool for the hotel that:

1. **Managers / owner** see in real time how labour cost is moving during the month and whether each department is **within budget** (budget → actual to date → projected month end).
2. **Managers** build schedules from shift legends (incl. split shifts like `09:00–11:00 / 15:00–20:00`) and approve the daily Forma 76 (actual hours).
3. **Employees** (no email needed) log in with username + password and see their schedule, worked hours for the month, estimated pay and salary advances.
4. **Accountants** get a monthly export of hours; they do the real payroll in their own software.

Not a goal: legal/payroll accuracy, overtime and night-work rules. Numbers are estimates.

## 2. Key decisions

| Topic | Decision | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, Server Actions), TypeScript, Tailwind 4 | Known stack |
| `cacheComponents` | **Off** | Every page is per-user and live; no static shell to gain |
| Database | **Neon or Supabase Postgres** (EU – Frankfurt) via `pg` driver in production; **PGlite** (embedded Postgres) locally when `DATABASE_URL` is empty | Same SQL, triggers work in both, no local install needed |
| ORM | Drizzle; immutability triggers in a hand-written SQL migration | |
| Auth | **Better Auth** with username plugin; public sign-up disabled; accounts created by admin/manager | Not all employees have email. An internal placeholder email (`<username>@staff.local`) satisfies the library and is never shown |
| No deletions | DB triggers block `DELETE` on all business tables and `UPDATE` on history tables. Changes are new rows ("latest row wins") | Enforced by DB, not just UI |
| Audit | Every insert/update on business tables writes to `audit_events` with actor, before/after JSON and a SHA-256 hash chain | Tamper-evident history |
| Money | Integer euro cents | No float errors |
| Cost model | `employee_rates.hourly_rate_cents` (gross/hour, shown to employee as estimate) × `employer_cost_factor` setting (default 1.19) = cost used for budgets | Simple, good enough |
| History stability | Schedule and timesheet rows snapshot segments, paid minutes and department, so later edits to legends/employees don't rewrite past months | |
| Hosting | Vercel `fra1` + Neon `aws-eu-central-1` | GDPR, latency |

## 3. Roles

| Role | Can do |
|---|---|
| `employee` | Own schedule, own hours, estimated pay, own advance requests; department schedule if `can_view_department` |
| `manager` | Everything for **their departments**: schedule, Forma 76 approval, correction requests, advance requests for staff, department dashboard |
| `top_manager` | All departments like a manager + **approves/rejects corrections of approved days** + advance decisions |
| `owner` | Read-only on everything, all dashboards, sets budgets |
| `accountant` | Read-only hours + exports |
| `admin` | Users, departments, employees, rates, legends, settings |

## 4. Data model (core)

```
user / session / account / verification   (Better Auth; user.role, user.username)
departments
department_managers (user ↔ department)
employees (user_id?, department_id, employee_no, can_view_department, active)
employee_rates (employee_id, hourly_rate_cents, effective_from)        append-only
shift_templates (code, name, color, segments[], paid_minutes, department_id?)
schedule_entries (employee_id, work_date, kind shift|off|absence, segments, paid_minutes, department_id)   append-only, latest wins
timesheet_entries (Forma 76 approved versions, same snapshot fields + version)                            append-only
correction_requests + correction_decisions                                                                 append-only
budgets (department_id, month, amount_cents, hours?)                                                       append-only, latest wins
advance_requests + advance_decisions                                                                       append-only
settings (key/value)
audit_events (hash chained)
```

Forma 76 day flow: `schedule (prefill) → manager edits → approve (version 1, locked)` → change needed → `correction request (reason)` → top manager `approve → new version` / `reject`.

Dashboard numbers per department & month:
- **Actual** = approved timesheet paid hours × rate × cost factor
- **Projected** = Actual + scheduled hours on days not yet approved × rate × cost factor
- **Budget** = latest budget row for that month

---

## 5. Phases

### Phase 0 — Setup
- [x] Next.js 16 scaffold, Tailwind, ESLint
- [x] Drizzle + Neon driver + PGlite fallback for local dev
- [x] Better Auth (username/password, sign-up disabled)
- [x] Migration runner + seed script with demo data
- [x] PLAN.md (this file)
- [ ] Create Neon project (EU) and set `DATABASE_URL` — **needs owner action**
- [ ] GitHub repo + Vercel project — **needs owner action**

### Phase 1 — Foundation
- [x] Schema: departments, employees, rates, shift templates, settings, audit
- [x] DB triggers: block deletes, block updates on history tables, audit with hash chain
- [x] Login page (username + password), logout, role-based redirect
- [x] App shell with navigation per role
- [x] Admin: departments (create, rename, deactivate)
- [x] Admin: employees (create with optional login, edit, deactivate, rate history)
- [x] Admin: shift legends (segments, auto paid hours, colour, deactivate)
- [x] Admin: manager ↔ department assignment
- [x] Audit log viewer (admin/owner) + hash chain verification
- [x] Password reset by admin (any user) / top manager (employees)
- [x] Deactivated users cannot log in (checked at session creation and on every request)
- [x] `npm run db:check` — proves deletes/updates are blocked and tampering is detected
- [ ] Managers manage employees of their own departments (currently admin + top manager only) — decide in Phase 2

**Phase 1 verification (2026-10-28):** typecheck, lint and production build clean; `db:check` all passed; HTTP smoke test of every role (admin, owner, top manager, manager, employee) — correct pages / redirects, manager sees only own departments; forms tested over HTTP: create department, duplicate rejected, create employee with login, split legend `10:00-14:00 / 18:00-22:30` − 30 min = 8 h, invalid hours rejected, deactivated employee login → 403. Login rate limit active (3 attempts / 10 s).

### Phase 2 — Schedules
- [ ] Weekly schedule grid per department (employees × days), pick legend / off / absence per cell
- [ ] Live counters: hours and cost per employee & week, department cost vs budget for the month
- [ ] Copy previous week
- [ ] Employee "My schedule" (mobile first)
- [ ] Department schedule view for employees with permission
- [ ] Schedule change history per cell

### Phase 3 — Forma 76 (daily actual hours)
- [ ] Daily screen per department, prefilled from schedule
- [ ] Manager edits times / absence code and approves (locks day)
- [ ] Correction request with reason for approved days
- [ ] Top-manager queue: approve / reject corrections
- [ ] Monthly Forma 76 grid view (employees × days) + Excel/CSV export for accountants

### Phase 4 — Budget dashboard
- [ ] Budgets per department per month (owner/admin)
- [ ] Dashboard: budget / actual / projected / status per department + hotel total
- [ ] Cumulative chart (budget line vs actual + projection)
- [ ] Drill-down per department → per employee hours and cost
- [ ] Unapproved-days warning (days in the past without approved Forma 76)

### Phase 5 — Employee money view
- [ ] My hours this month (scheduled vs approved)
- [ ] Estimated pay = approved hours × rate − approved advances
- [ ] Advance requests (employee or manager on behalf) + manager/top-manager decision
- [ ] PWA install (home-screen icon)

### Phase 6 — Hardening & rollout
- [ ] Bulgarian UI translation (next-intl) — confirm language with owner
- [ ] Separate Postgres role without DELETE privileges for the app (Neon)
- [ ] Automated tests: paid-minutes calc, permission checks, trigger blocks
- [ ] Backups / restore test (Neon PITR)
- [ ] Pilot with one department for a full month, compare with accountants' figures
- [ ] Optional: occupancy/revenue input → labour cost % and cost per occupied room

---

## 6. Open questions

- [ ] UI language: Bulgarian only, or Bulgarian + English?
- [ ] Budgets in € only, or also in hours? (model supports both; UI shows € first)
- [ ] Employees on monthly salary: enter an hourly equivalent? (current assumption: yes)
- [ ] Employer cost factor — confirm with accountants (default 1.19)
- [ ] Who decides advances: manager alone, or manager + top manager?
- [ ] Should employees see schedule changes immediately, or only after the manager "publishes" a week?

## 7. Running locally

```bash
npm install
cp .env.example .env.local     # set BETTER_AUTH_SECRET; leave DATABASE_URL empty for local PGlite
npm run db:migrate
npm run db:seed                # demo users, password: demo1234
npm run dev
```

Demo logins (after seed): `admin`, `owner`, `topmanager`, `manager.fo`, `manager.hk`, `ivan.petrov` (employee) — password `demo1234`.

Note: with PGlite, stop `npm run dev` before running migrate/seed (single-process database).

## 8. Change log

- 2026-10-28 — Project created; Phase 0 + Phase 1 built and verified. Next: Phase 2 (schedule grid).
