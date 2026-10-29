# Hotel Schedules App — Plan & Progress

Status legend: `[x]` done · `[~]` in progress / partial · `[ ]` pending

Last updated: 2026-10-29 (Phases 0–5, 7, 9–12 done; Phase 8 = AI, planned)

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
| `employee` | Own schedule (list or table), the published schedule of their department, own hours, estimated pay, own advance requests, shift swaps |
| `manager` | Everything for **their departments**: schedule, Forma 76 approval, correction requests, advance requests for staff, department dashboard |
| `top_manager` | All departments like a manager + **approves/rejects corrections of approved days** + advance decisions |
| `owner` | Read-only on everything, all dashboards, sets budgets |
| `accountant` | Read-only hours + exports; approves/rejects advances and marks them as given |
| `admin` | Users, departments, employees, rates, legends, settings |

## 4. Data model (core)

```
user / session / account / verification   (Better Auth; user.role, user.username)
departments
department_managers (user ↔ department)
employees (user_id?, department_id, employee_no, active)   (can_view_department column unused since 2026-10-29)
employee_rates (employee_id, hourly_rate_cents, effective_from)        append-only
shift_templates (code, name, color, segments[], paid_minutes, department_id?)
schedule_entries (employee_id, work_date, kind shift|off|absence, segments, paid_minutes, department_id)   append-only, latest wins
timesheet_entries (Forma 76 approved versions, same snapshot fields + version)                            append-only
correction_requests + correction_decisions                                                                 append-only
budgets (department_id, month, amount_cents, hours?)                                                       append-only, latest wins
job_roles (department, name) · locations (department, code, name)          renamed/deactivated, never deleted
employees.job_role_id / home_location_id (usual role + place) · schedule/timesheet rows carry job_role_id · each segment may carry locationId
advance_requests + advance_decisions + advance_payments ("given" by accounting)                           append-only
swap_requests (requester, colleague, date1, date2?, snapshot of published entries) + swap_events          append-only
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
- [x] GitHub repo: https://github.com/MarinaPalace/schedules-app
- [x] DB driver switched to `pg` so Neon **or** Supabase work with just a connection string
- [ ] Create Neon or Supabase project (EU) and set `DATABASE_URL` — **owner action, later**
- [ ] Vercel project (region `fra1`) + env vars — **owner action, later**

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
- [ ] Managers manage employees of their own departments (currently admin + top manager only) — open question

**Phase 1 verification (2026-10-28):** typecheck, lint and production build clean; `db:check` all passed; HTTP smoke test of every role (admin, owner, top manager, manager, employee) — correct pages / redirects, manager sees only own departments; forms tested over HTTP: create department, duplicate rejected, create employee with login, split legend `10:00-14:00 / 18:00-22:30` − 30 min = 8 h, invalid hours rejected, deactivated employee login → 403. Login rate limit active (3 attempts / 10 s).

### Phase 2 — Schedules
- [x] Schedule grid per department, week **and** month view (`/schedule`)
- [x] "Paint" mode: pick a legend / Off / absence (О, Б, НП, Н) / custom hours / Clear, then click or drag across cells; auto-saves
- [x] Live totals: hours and cost per employee, hours per day, and month projected cost vs budget banner
- [x] Copy previous week
- [x] Cell history (`/schedule/history`): every plan change, Forma 76 version and correction, with who/when
- [x] Employee "My schedule" (mobile first) – next 7 days + month list
- [x] Department schedule for employees (now: My schedule → Table → "Whole department"), no money shown
- [x] Schedule rows snapshot hours and break, so editing a legend never rewrites past days (marked "*")

### Phase 3 — Forma 76 (daily actual hours)
- [x] Daily screen per department, prefilled from schedule (`/timesheet`)
- [x] Manager adjusts hours / break / absence code and approves selected rows → locked (version 1)
- [x] Future days cannot be approved; double approval blocked (also by a unique DB index)
- [x] Change of an approved day = correction request with mandatory reason
- [x] Top-manager queue (`/corrections`): approve → new version, or reject; stale requests refused
- [x] Month grid (`/timesheet/month`) – approved values, unapproved plan in grey brackets, totals, absence counts
- [x] CSV export for accountants (BOM + `;` + decimal comma → opens directly in Bulgarian Excel)

### Phase 4 — Budget dashboard
- [x] Budgets per department per month in € (+ optional hours), copy from previous month (`/admin/budgets`)
- [x] Employer cost factor setting (owner/admin)
- [x] Dashboard: budget / actual / projected / % / status per department + hotel total (`/dashboard`)
- [x] Cumulative chart: budget pace vs actual vs projected, "today" marker
- [x] Drill-down per department → per employee approved/planned hours and cost (`/dashboard/[dept]`)
- [x] Warning for past days scheduled but not approved

### Phase 5 — Employee money view & advances
- [x] My hours this month: approved + still planned
- [x] Estimated gross pay (earned so far / projected), approved advances, expected rest
- [x] Advance request by employee (`/me`) or by manager on behalf (`/advances`)
- [x] Manager of the department / top manager / admin decides; nobody decides their own advance
- [x] Monthly list of advances with approved total (accountants can see it)
- [x] PWA: manifest + icon → "Add to home screen"

**Phases 2–5 verification (2026-10-28):** typecheck, lint, production build clean; `npm test` 9 unit tests pass (split/overnight hours, breaks, calendar incl. DST week, rates by date, cost maths, euro parsing); `db:check` passes. Every page loaded over HTTP for admin, top manager, manager, owner, accountant, employee. Server actions exercised over HTTP: paint shift ✓, paint in another department ✗ refused, employee paint ✗ refused, bad custom hours ✗, approve today ✓, approve twice ✗, approve future ✗, correction ✓, duplicate correction ✗, manager deciding correction ✗, top manager approve ✓ → v2, decide twice ✗, other-department manager deciding advance ✗, own manager approves ✓, employee page shows advance deducted, budgets form ✓, own-advance form ✓; dashboard numbers match (sick-note correction reduced cost by exactly 9 h × €7.50 × 1.19 = €80.33); audit chain intact afterwards. Bug found and fixed: a permission query outside an open transaction deadlocked on local PGlite.
**Not yet done:** a visual click-through in a real browser.

### Phase 7 — People, phones & tablets (done 2026-10-28)
- [x] Admin, owner and GM create departments and employees and assign department managers
- [x] Role chosen on the employee page; nobody can hand out more power than they have (admin → all, owner → all but admin, GM → employee/manager)
- [x] Managers and the GM are employees too → they appear in schedules, Forma 76, and get their own pay view/advances
- [x] Existing logins can be connected to an employee record
- [x] Team page (`/team`): all my staff with today's shift, month hours, tap-to-call phone, links to their schedule
- [x] Employee phone numbers
- [x] Schedule editor rebuilt for phones:
  - **Day** mode: day strip → list of people → big-button shift picker → jumps to the next person automatically
  - **Person** mode: one person's days (week or month) → picker jumps to the next day; **Repeat this week** fills the rest of the month
  - **Table** mode (tablet/computer): tap a cell to pick, or choose a legend and drag across cells
  - Coverage per day (e.g. M × 2, A × 1, Off × 3, not planned × 2)
  - **Undo** (multi-step) and **Publish** in a bottom bar within thumb reach; phones open in Day mode, computers in Table; last choice remembered
- [x] Bottom tab bar on phones (main screens per role + Menu with everything, language, theme, sign out)
- [x] Dark mode: Light / Dark / Auto (follows the phone), remembered per device
- [x] Forma 76 on phones: one card per person, big checkboxes, sticky "Approve" bar, select all
- [x] Phone-friendly controls: 44–64 px touch targets, 16 px inputs (no iOS zoom), safe-area support
- [x] Verified with a scripted phone (390×844) and tablet (820×1180) run in Edge: pick → auto-advance → save → undo, repeat week, publish count, menu, dark mode, employee view – no browser errors. Bugs found and fixed: undo history cleared after each save; "repeat week" cleared days before a mid-week month start; dark mode backgrounds stayed white.

### Phase 9 — Swaps, accounting, PDF, end-user review (done 2026-10-29)
- [x] **My schedule → List / Table**; tick **Whole department** to see every colleague's published plan (remembered per device; phones scroll to today). Every employee may see their department – the admin "can see department schedule" flag is gone
- [x] **Shift swaps** (`/me/swap`, `/swaps`): exchange plans with a colleague on one day or two days (covers "take my shift", "I take your Saturday, you take my Thursday"). Tap a colleague's day in the table to start
  - Flow: employee asks → **colleague accepts/declines** → **department manager approves/rejects** (GM/admin too). Requester can cancel while open; open requests expire when the day passes
  - Approval writes new schedule rows (`swap_request_id`) that employees see immediately – no re-publishing
  - Refused: past days, days already approved in Forma 76, leave/sick days (О, Б, НП, Н), identical plans, overlapping open requests, colleague without login, and **stale requests** (plan changed after the request, published or not)
  - A manager taking part in a swap can't approve it – another manager or the GM must
  - DB: append-only + audited; partial unique indexes make "accepted" and the final outcome happen at most once
- [x] **Advances**: accounting can approve/reject and **mark as given** (`advance_payments`); statuses pending → approved → given / rejected; "to hand out" queue; cards show earned-so-far and advances already approved this month; employee sees "given"
- [x] **Schedule PDF** (`/schedule/pdf`, button on the schedule and in the employee table): A4 landscape, shift colours, totals per person/day, **legend with hours** (times, break, paid hours) + absence symbols, page numbers, Cyrillic font (PT Sans, OFL). Managers print the current plan (marked if unpublished parts are included); employees print the published plan of their own department
- [x] Counters in the navigation for things waiting for you (swaps to answer/approve, corrections for the GM, advances to decide/hand out)
- [x] Dashboard warns when a department has upcoming changes that are **not published** (staff see nothing until then)
- [x] Employees see "not published yet" instead of "not planned yet" when the manager hasn't published that day
- [x] Small phone fixes: "8 h" / "(−30 min)" no longer break across lines, minute unit translated, compact list for finished swaps

**Phase 9 verification (2026-10-29):** typecheck, lint, production build clean; `npm test` 21 tests (incl. swap state/moves and a 40-row Cyrillic PDF); `db:check` incl. new tables and the unique "one outcome" index. Scripted browser runs against the production build on a fresh demo database (phone 390×844 + desktop): 52 checks – full swap flow (request from the table → badge → accept → approve → both schedules change), overlap, cancel, decline, stale, own swap via GM, two-day swap, absence blocked, unpublished plan hidden; advances (employee request, manager on behalf, accountant approve/reject/given, owner read-only); PDF permissions (other department 403, too long 400, signed out → login) and visual check of BG/EN/RU PDFs; every page for 9 users in Bulgarian, phone + desktop, dark mode – no console errors, no horizontal overflow on phones.

**End-user review – open points (not built):**
- ~~Staff only learn about swap requests / published schedules when they open the app~~ → done in Phase 10 (email + Telegram)
- Only staff with a login can take part in swaps – create logins for everyone who should use the app
- Navigation counters refresh on every action and page load, not live while a page stays open
- Advances count in the month they were requested (not a chosen payroll month)
- Swaps are limited to the same department and to the next 120 days

### Phase 10 — Email & Telegram: notifications and password links (done 2026-10-29)
- [x] **No passwords typed or sent by anyone.** Creating a login (employee page, Users & roles, new employee form) creates the account with an unknown random password and a **one-time setup link** (7 days); the person opens it, sees their username, chooses a password (min. 8) and is signed in
- [x] Admin "Reset password" → **reset link** (2 hours) instead of typing a password; "Forgot password?" on the sign-in page (same answer for unknown users, max 3 links/hour); "Change password" under **My account** (needs the current one). Resets and changes sign out other devices and send a "your password was changed" notice
- [x] Links go by **email and/or Telegram** when the person has them; the admin always also sees the link + **QR code** to hand over in person, plus a **Telegram QR**: scanning it and pressing Start connects the person's Telegram and the bot sends the password link there
- [x] Only a SHA-256 hash of each link is stored; a new link replaces older ones; used/expired links stop working; links are redacted in the delivery log; DB allows only "mark as used"
- [x] **Notifications** (email + Telegram, in the language the person uses the app in): swap asked / accepted / declined / cancelled / to approve (department managers) / approved / rejected; **schedule published** (only people whose plan changed, with their days); advance requested (department managers + accounting) / approved / rejected / given; Forma 76 correction requested (GM) / decided (the manager who asked). Sent after the response (`after()`), so nobody waits
- [x] **My account** page: contact email, Telegram connect/disconnect, email/Telegram switches, test message, change password
- [x] **Admin → Notifications**: email/Telegram set-up status, "Connect bot to this app" (Telegram webhook, needs https), log of sent messages with errors
- [x] Telegram webhook `/api/telegram/webhook` checks the secret header; `npm run telegram:poll` for local development
- [x] Set-up: `SMTP_URL`, `MAIL_FROM`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `APP_URL` (README → "Logins, email and Telegram")

**Phase 10 verification (2026-10-29):** typecheck, lint, tests, build clean; `db:check` passes. Browser runs against a fake SMTP server and a fake Telegram Bot API (same code paths as production, only the addresses differ), 51 checks: invite email with button → set password (mismatch/too short refused) → signed in; link reuse refused; webhook with a wrong secret 403; bad Telegram token answered; Telegram connect from My account; Telegram-only invite (bot sends the setup link after Start); forgot password → email + Telegram, old password rejected, other device signed out, notice sent, rate limit; admin reset link handed over in person; change password (wrong current refused); publish → only changed people get their days; full swap chain incl. "approver isn't notified of her own action"; advance request/approve/given; correction request/decision; blocked bot logged as failed without breaking anything; no tokens in the admin log; webhook on http refused with an explanation.

**Not done:** real delivery with your provider/bot (needs your SMTP details and a bot from @BotFather – see README); Telegram only reaches people who pressed Start once.

### Phase 11 — Custom hours in the legend, timeline (done 2026-10-29)
- [x] "Other hours" in the shift picker (and the paint toolbar) now take an **unpaid break**; the picker shows the paid hours and refuses a break longer than the shift
- [x] **Save as a new legend** right from the picker (code, name, colour) – managers can create legends for their own departments; it is applied to the cell and appears in the toolbar at once
- [x] Hours entered without a legend get an **automatic code** (P1, P2… / Р1, Р2…; same hours + break = same code, numbered by start time) – shown in every grid instead of a bare number, and listed in the **legend** with times, break and paid hours: under the schedule, in the employee table and in the PDF
- [x] **Timeline** view (4th mode next to Day/Person/Table): a bar per person over the day, **staff per half hour**, "who is at work from–to" (e.g. 07:00–12:00 → at least N the whole time, who is there the whole time, who only part of it), and the week as a **staff-per-hour heat map**. Overnight shifts count on both days; split shifts and breaks between blocks are handled
- [x] The counting lives in `src/lib/coverage.ts` (pure functions with tests) so the AI assistant (Phase 8) can check suggested schedules against staffing needs
- Known limit: in week view an overnight shift from the Sunday before the shown week isn't counted on Monday morning

**Phase 11 verification (2026-10-29):** typecheck, lint, 27 unit tests (incl. coverage: overnight, split shifts, whole/part presence, minimum staff; automatic codes), production build. Browser run (21 checks): break shown and too-long break refused, same hours → same code, legend lines, save-as-legend (applied, in toolbar, duplicate code refused), toolbar custom paint, all kept after reload, timeline 07–12 and 16–20 counts, half-hour count, no overflow on a phone, PDF legend, employee table legend, admin legends page. Earlier suites re-run: all pass. Bugs found and fixed: saving a legend refreshed the board and hid the change; closing the picker while saving made it reopen.

### Phase 12 — Locations (restaurants, bars) and roles (done 2026-10-29)
- [x] **Locations & roles** page (`/setup`, admin/owner/GM and the department's own manager): roles per department (Waiter, Helper waiter, Assistant manager…), locations with short codes (R1 Main restaurant, B1 Lobby bar…), and each person's **usual role and place**
- [x] Schedule: **location tabs** – each restaurant/bar has its own schedule (its usual staff + anyone with a block there; "show all staff" to plan others); new shifts go to the location being planned (else the person's usual place). Totals and the **PDF per location** count only the hours worked there
- [x] Shift picker: **place** (one, or **different place per block** for split shifts worked one after the other) and **role for this shift** (defaults to the usual role). Grid tags: place codes (e.g. "R1+B1") in "All locations", "@B2" for a shift elsewhere, role tag when not the usual role
- [x] **Timeline per role**: staff per half hour for every role (at the selected location or all), **staff per location**, role filter, "from–to" check with the minimum per role (e.g. 09:00–11:00: 3 Waiter · 0 Helper waiter · 1 Assistant manager)
- [x] **Hours by role** report (`/timesheet/roles`, also for accounting) + CSV: approved Forma 76 hours per role per person, planned in brackets, **hours outside the main role** highlighted (may be paid at another rate). Approved days keep the role of that day's plan; corrections keep the role
- [x] Employees see where they work ("09:00–11:00 Main restaurant / 15:00–20:00 Lobby bar"), also in notifications; place codes in their table
- [x] Swaps and "copy previous week" keep place and role; demo data: F&B with 5 roles, 4 places, 8 staff
- Not done: pay rates per role (the report shows the hours; accounting applies the rate)

**Phase 12 verification (2026-10-29):** typecheck, lint, 30 unit tests (incl. counts per role/place, a split shift at two places counted at one at a time, hours at a place sharing the break), build, `db:check`. Browser run (24 checks): setup by the department's manager (add location, duplicate code refused, usual place), per-location schedule rows, split shift R1+B1, shift in another role, all kept after reload, timeline 09–11 per role at R1 (3/0/1), no waiter at R1 at 16:00 while B1 has 1, role filter, no overflow on a phone, location PDF, Forma 76 approval keeps the role → report shows 8 h outside the main role, CSV, accountant access. All earlier suites re-run on fresh data: pass.

### Phase 13 — Onboarding from an empty database + staffing needs (done 2026-10-29)

Research, plan and review (2026-10-29), written after setting up from an empty database. Built and verified the same day (unit tests for usernames, pay parsing, Excel rows and need rules; an end-to-end run from an empty database: owner's welcome → GM → department with a new manager → locations → Excel import + invite slips → needs → schedule gaps, publish warning, dashboards, budgets, progress board, employee view; all earlier end-to-end suites re-run). Fixes found while testing: the welcome kept the GM's invite panel after the refresh; the “new department” and “add employee” boxes no longer close after the first one is created (the invite QR stayed hidden); printed slips only for people without email/Telegram (printing replaces the link, so an emailed invite kept working); managers can't edit their own or other managers' pay; progress board shows the manager's name.

**Decisions (2026-10-29)**
1. Department managers **can set hourly rates** for their own staff.
2. The **GM can create departments** (with their managers).
3. Staffing needs vary by **weekday and by season**, and **one-off dates** (events) are needed now.
4. The free-text **Position** is replaced by the department's **role list**.
5. Guidance on the setup is a **must**: the owner knows nothing about the app at first login.
6. **Pay vs total cost.** The owner's cost factor is **only for the total budget**. Employees and managers see only the **pay** – what the employee gets, e.g. "1000 € for 160 hours" or "6.25 € per hour". No "gross", no taxes, no factor.

**What a new owner meets today (empty database)**
- After login they land on the dashboard. It only says *"No departments assigned to you."* It doesn't explain what the app does, what to do first, or where.
- The hotel name exists as a setting but can't be edited anywhere.
- Managers are created on one page (Users & roles), assigned on another (Departments), and given an employee record on a third (Employees). The required order isn't shown.
- On *Locations & roles*, the number next to each name is the **display order** – unlabelled, it looks like a quantity.
- A department manager **can't add staff, logins or legends**.
- "Role" means two things: access level (Employee, Manager, GM…) and job (Waiter…). There's also a free-text "Position".

**The intended flow**
1. **Owner** (first login) → welcome → hotel profile → creates the **General Manager**. Either continues the setup or hands it over.
2. **Owner or GM** → creates each **department** with its **manager(s)** in one step. Either continues or hands each department to its manager.
3. **Department manager** → **locations** → **roles** → **staffing needs** → **shift legends** → **staff** (role, usual place, rate, login) → first schedule → publish.
4. **Accountant** → invited by owner/GM → notifications, Forma 76 and hours-by-role exports, advances, rates.
5. **Employees** → get an invite (email / Telegram / printed slip) → choose a password → see their schedule.

#### 13a — Permissions and quick fixes (small)
- [x] **Managers run their own department(s)**:
  - create, edit and deactivate employees;
  - create employee logins and send invite/password links;
  - set role, usual place and **hourly rate** (with the date it starts – the rate history is kept as today).

  Managers can't create managers, and can't move people to another department; the GM does moves.
- [x] **Rate changes are visible:** every change is in the audit log (as today), and the GM is notified when a manager changes a rate.
- [x] Managers manage their department's **shift legends**. Hotel-wide legends stay with owner/GM.
- [x] The **GM** can create and rename departments and assign their managers. The owner keeps hotel settings, the GM's login and email/Telegram set-up.
- [x] **Wording:**
  - access level = **"Access"** (Достъп); job = **"Position"** (Длъжност), chosen from the role list;
  - the old free-text field is removed;
  - a helper turns existing free-text positions into roles in one click (per department, with a preview).
- [x] Order fields: drop the number box; new items go to the end; ↑/↓ to reorder.
- [x] **Automatic usernames** from the name, with Cyrillic → Latin transliteration (Иван Петров → ivan.petrov). Editable; duplicates get a number.
- [x] **Hotel profile** (owner): hotel name (shown in the header, PDFs and messages), default language for new accounts, employer cost factor (exists today, under Budgets).

#### 13a+ — Pay for staff and managers, total cost only in the budget (decision 6)
Today the factor is multiplied into the money managers see: the schedule's cost column, the budget bar, their dashboard, and a footnote that names the factor. Employees don't get the factor, but their pay is labelled **"gross"**, with a note about taxes and contributions.
- [x] **The hourly rate means pay:** what the employee receives for an hour ("Hourly pay").
  - It can also be entered as a monthly amount + hours, e.g. 1000 € for 160 h → 6.25 €/h.
  - The rate history (with start dates) stays as it is.
- [x] **Employees** see "Your pay (estimate)":
  - earned so far, expected this month and the rate per hour;
  - advances are taken off the same amount;
  - the words "gross", "taxes" and "contributions" are removed from their screens.
- [x] **Managers** see pay only:
  - hours × rate in the schedule's cost column, totals and their dashboard;
  - no factor, and no footnote mentioning it.
- [x] **Budget bar for managers:** the budget is set as a total cost, so it's shown converted to pay (budget ÷ factor) and called **"pay budget"**. The comparison stays correct without showing the factor.
- [x] **Owner, GM and accountant** see both columns: *pay* and *total cost* (pay × factor).
  - Budgets are entered and compared as total cost, as today.
  - The dashboard can switch between "pay" and "total cost".
- [x] **The factor** moves to the hotel profile, with a plain explanation: "total cost to the hotel for every 1 € of pay".
  - Because rates now mean the take-home pay, the right factor is usually **higher than 1.19**; the accountant can tell the owner the number.
  - Changing it changes only budgets and totals, never what employees see.
- [x] Stored data doesn't change; only what each role sees and the wording. Check before entering real rates: the rates must be entered as pay (no rates are in the database yet).

#### 13b — First-run guidance (a must)
- [x] **Welcome wizard** the first time an owner/admin logs in to an empty hotel. 3–4 short screens, works on a phone, can be left and resumed:
  1. *What this app does*, in one screen: plan shifts → employees see them → daily Forma 76 → labour cost vs budget. Plus who does what (owner, GM, managers, accountant, staff).
  2. *Your hotel*: name, language, cost factor (explained in plain words, default 1.19).
  3. *Who sets it up?* "I'll do it myself" or "Invite my General Manager" (name, username, email → invite link + QR).
  4. Optional: *Email and Telegram* – only if it's set up; else a link to how-to and "later".

  Ends on the setup checklist.
- [x] **Setup checklist** ("Getting started"), different per role.
  - Each step says **why** it's needed, links to the page, and ticks itself when done.
  - Progress like "4 of 7"; it can be hidden once everything is done.
  - *Owner:* hotel profile · GM · departments + managers · budgets · email/Telegram · accountant.
  - *GM:* departments + managers · each department's progress (see 13c board) · budgets · accountant.
  - *Manager:* locations · roles · staffing needs · legends · staff + logins · first schedule · publish.
  - *Accountant:* notifications · where Forma 76 / hours-by-role exports are · advances.
- [x] **First-login intro for every other role.** 2–3 cards on what they can do and where. For a manager: "your department is ready to set up – start here". Shown once; can be reopened from the menu.
- [x] **Helpful empty pages.** Every list that's empty says what belongs there, why, and has the one button to add the first item. Nothing should say only "nothing here".
  - Example: *No locations yet – add the restaurants and bars of F&B, each will get its own schedule. [+ Add location]*
- [x] **Next-step prompts** after each key action. E.g. after creating a department: "Next: add its manager" / "Next: add its locations".
- [x] **"?" help on each page**: two or three sentences in the user's language on what the page is for, with a link to the guide.
- [x] **Guide page** (Help): the flow above as a simple picture, one short section per role, and a "common questions" list (publish, swaps, Forma 76, advances, PDFs).
- [x] All guidance in **BG / EN / RU**, phone-first, plain words – no technical terms.

#### 13c — Departments and staff onboarding
- [x] **Department wizard** (owner/GM):
  - name;
  - managers: pick existing people, or create a new manager with name/username/email. This makes the login + employee record + assignment and sends the invite;
  - optionally **copy the set-up of another department** (roles, legends, locations without staff).
- [x] **Setup progress board** (owner/GM). One row per department, so the GM sees at once who's behind:
  - manager invited / logged in;
  - locations;
  - roles;
  - staffing needs;
  - staff count;
  - logins activated;
  - first schedule published.
- [x] **Presets** when creating a department; tap to add, rename freely.
  - Roles – F&B: Waiter, Helper waiter, Bartender, Assistant manager, Cook. Housekeeping: Maid, Laundry, Supervisor. Front office: Receptionist, Night auditor, Concierge.
  - Common legends: morning / afternoon / night.
- [x] **Bulk add staff**: paste rows from Excel. Columns: name, phone, email, position (role), usual place, rate. Preview with errors marked, then create all, inviting those with email.
- [x] **Invite status** per department: invited / link opened / logged in / never logged in. **Resend**, one by one or to everyone not logged in yet.
- [x] **Printable invite slips** (PDF): one per employee with name, username, password-link QR and Telegram QR. For staff without email.

#### 13d — Staffing needs per location (how many of each role, when)
- [x] **Seasons** (hotel-wide, owner/GM): named date ranges reused by every department, e.g. *Low 01.11–31.03*, *High 01.06–30.09*.
- [x] **Staffing need** = location + role + time range + number of people.
  - Defined for a **weekday set** (e.g. Mon–Fri, Sat–Sun) and optionally a **season**.
  - **One-off dates** (events, e.g. a wedding at R2 on 14.06) replace the weekday/season needs of that location on that date.
- [x] **Which need applies on a date:** one-off date › season › all-year. Within each, the weekday rule. The editor and the timeline always show *which* rule applies ("High season, Sat–Sun").
- [x] History kept, like budgets: changes are new rows, the latest wins.
- [x] **Editor per location** (manager): a grid.
  - Rows = time blocks (06:30–08:30, 08:30–14:30…); columns = the department's roles; cells = count.
  - Tabs for the weekday sets and seasons.
  - "Copy to other days / season / location".
  - Example: R2 · High season · Mon–Sun:
    - 06:30–08:30: 2 Waiters + 1 Assistant manager;
    - 08:30–14:30: 5 Waiters + 1 Assistant manager.
  - **The roles with a number at a location are the roles that work there.**
- [x] **Needed vs planned** wherever it matters:
  - timeline: a "needed" line per role, red/green slots ("08:30–09:00 Waiters 4 / 5");
  - ⚠ on days with gaps in the Table/Day views;
  - dashboard list of gaps ("R2 Tue 06:30–08:30: 1 waiter missing");
  - a warning before **Publish**.

  Counting uses `src/lib/coverage.ts` (`dayBlocks`, `pick`, `minStaff`), already built and tested.
- [x] **Over-staffing** shown too (with cost), so managers can trim as well as fill.
- [x] **Cost of the needs:** needs × average rate of the role × cost factor → planned monthly cost per location/department. A starting point for budgets, shown next to the budget form.
- [ ] Phase 8 (AI) uses the needs as its main input: fill the gaps with the right roles at the right places, then the manager reviews.

#### 13e — Demo database from real set-up data
- [x] `npm run db:save-demo`: saves the local database (the data entered by the owner) as the demo snapshot.
- [x] `npm run db:reset` then restores that snapshot – plus any newer migrations – instead of the built-in example. `npm run db:empty` stays for a clean start.

#### Who does what after this phase
| | Owner / admin | GM | Department manager | Accountant |
|---|---|---|---|---|
| Hotel profile, email/Telegram, seasons, **cost factor** | ✓ | seasons | – | – |
| Money shown | pay + total cost | pay + total cost | **pay only** (budget as "pay budget") | pay + total cost |
| Create the GM login | ✓ | – | – | – |
| Accountant logins | ✓ | ✓ | – | – |
| Departments + their managers | ✓ | ✓ | – | – |
| Locations, roles, staffing needs, legends | ✓ all | ✓ all | ✓ own dept | – |
| Staff, employee logins, **hourly rates** | ✓ all | ✓ all | ✓ own dept | see |
| Move staff between departments | ✓ | ✓ | – | – |
| Budgets | ✓ | ✓ | see | see |
| Schedules, Forma 76 | see / ✓ | ✓ all | ✓ own dept | see |
| Exports, hours by role, advances | ✓ | ✓ | own dept | ✓ all |

**Assumptions to confirm** (built this way unless you say otherwise)
- Accountants **see** rates but don't change them.
- The built-in `admin` login stays a technical account. The welcome wizard suggests the owner creates **their own owner login** and uses it day to day.
- Seasons are hotel-wide, not per department.
- Managers see their budget as a **pay budget** (budget ÷ factor) rather than not seeing the budget at all.

**Order and size**
1. **13a** permissions + quick fixes (S) – unblocks managers today.
2. **13b** first-run guidance (M) – a must; built together with 13a so every new page has its empty state and "?" from the start.
3. **13c** department wizard and staff onboarding (M).
4. **13d** staffing needs (L) – the core of planning.
5. **13e** demo snapshot (S) – any time, once your set-up data is in.

Each part ends like the earlier phases: unit tests for the rules, plus browser runs. Those cover the full flow from an empty database as owner → GM → manager → accountant → employee, on phone and computer, in BG/EN/RU.

### Phase 8 — AI schedule assistant (future)
- [ ] Admin enters an OpenRouter API key (stored server-side only, encrypted; never sent to the browser) and picks a model
- [ ] Uses the **staffing needs of Phase 13d** (per location, role, time, weekday/season/date) as the target; suggestions are checked with `src/lib/coverage.ts` before they are shown
- [ ] "Suggest schedule" for a week/month: sends staff, legends, last weeks' pattern, absences, budget and needs (no names/pay if not needed) → model returns cells as JSON
- [ ] Suggestion is applied as normal **unpublished** changes (amber dots) with one-tap **Undo**; manager reviews, edits, then publishes – the existing save/undo/publish flow already supports this
- [ ] Log every AI suggestion in the audit trail


- [x] Three languages: Bulgarian (default), English, Russian (next-intl; switcher on login + sidebar; remembered per device; browser language used first time)
- [x] Translation safety: typecheck fails on unknown keys; `npm test` fails if bg/ru miss a key or a {placeholder}
- [ ] Separate Postgres role without DELETE privileges for the app (Neon/Supabase)
- [ ] Visual review on desktop + phone; polish after first real use
- [x] Publishing: employees see the schedule only after the manager publishes (Publish button on the grid, amber dot = unpublished change, append-only publication log)
- [x] Automated tests: hour/cost calculations (`npm test`), trigger blocks (`npm run db:check`)
- [ ] Automated permission tests (currently verified manually over HTTP)
- [ ] Backups / restore test (provider point-in-time recovery)
- [ ] Pilot with one department for a full month, compare with accountants' figures
- [ ] Optional: occupancy/revenue input → labour cost % and cost per occupied room

---

## 6. Open questions

- [x] UI language → Bulgarian, English **and** Russian (decided 2026-10-28)
- [ ] Budgets in € only, or also in hours? (model supports both; UI shows € first)
- [ ] Employees on monthly salary: enter an hourly equivalent? (current assumption: yes)
- [x] Employer cost factor → 1.19 for now; owner/admin change it in **Budgets → Employer cost factor**
- [x] Who decides advances → department manager, GM **or accounting** (one decision); accounting then marks it as given (decided 2026-10-29)
- [x] Who may see the department schedule → **every employee** (decided 2026-10-29)
- [x] Managers add/edit employees → **Yes, for their own department** (changed 2026-10-29; was "No" on 2026-10-28) – see Phase 13a
- [x] Employees see changes → **only after the manager publishes** (decided 2026-10-28, built)

- [x] Managers approve their **own** Forma 76 day → **Yes** (decided 2026-10-28; every approval is in the audit log)

## 7. Running locally

```bash
npm install
cp .env.example .env.local     # set BETTER_AUTH_SECRET; leave DATABASE_URL empty for local PGlite
npm run db:migrate
npm run db:seed                # demo users, password: demo1234
npm run dev
```

Demo logins (after seed): `admin`, `owner`, `topmanager` (GM, works in Management), `accountant`, `manager.fo` (Front Office), `manager.hk` (Housekeeping + F&B), employees `ivan.petrov`, `petya.todorova` — password `demo1234`. The seed fills the current month with schedules, approved Forma 76 up to yesterday, budgets, one pending correction and one pending advance.

Tests: `npm test` (calculations + translations) and `npm run db:check` (no-delete rules + audit chain).

Local database notes:
- `npm run dev` applies new migrations automatically – at start and again on the next page load if a migration was added while it runs (local database only).
- `npm run db:reset` wipes and rebuilds the local demo database. Stop `npm run dev` first – the `db:*` scripts refuse to run while the app has the local database open.

## 8. Change log

- 2026-10-28 — Project created; Phase 0 + Phase 1 built and verified.
- 2026-10-28 — Phases 2–5 built and verified (schedule grid, Forma 76 + corrections + export, budget dashboard, employee pay view + advances, PWA). DB driver → `pg`.
- 2026-10-28 — Fixed "Failed query … break_minutes": a running dev server kept an old in-memory copy of the local database while it was rebuilt. Now: auto-migrate on start + lock file so scripts can't touch the database the app has open. Added BG/EN/RU and schedule publishing; open questions 2.1–2.4 answered. Next: visual review, Phase 6.
- 2026-10-28 — Phase 7: people/permissions rework, Team page, phone-first schedule editor (Day/Person/Table, picker, undo, repeat week), bottom navigation, dark mode, Forma 76 phone layout. Phase 8 (AI via OpenRouter) planned.
- 2026-10-28 — Fixed "Failed query … phone" again: a dev server started before a migration kept the old schema. Local migrations are now also checked on each request (cheap, once per new migration), so no restart is needed.
- 2026-10-29 — Phase 9: shift swaps (colleague → manager), employee table + whole-department view, accounting approves/hands out advances, schedule PDF with legend, navigation counters, unpublished-changes warning. End-user review findings listed under Phase 9.
- 2026-10-29 — Phase 10: email + Telegram notifications, password set-up/reset links instead of typed passwords, My account page, Admin → Notifications.
- 2026-10-29 — Phase 11: break + "save as legend" for custom hours, automatic legend codes (P1…), Timeline view with staff per half hour and "who is at work from–to".
- 2026-10-29 — Phase 12: locations and roles per department, per-location schedules/PDF, place per block and role per shift, timeline per role/location, hours-by-role report for pay.
- 2026-10-29 — Phase 13 planned (not built): permissions for managers (staff, logins, rates, legends), first-run guidance for the owner and every role, department wizard and staff onboarding, staffing needs by weekday/season/date per location, demo snapshot. Decisions 1–6 recorded (6: cost factor only for the total budget; staff and managers see pay only).
- 2026-10-29 — Phase 13 built: welcome wizard, per-role checklists and intros, guide and “?” help, hotel profile + seasons, department wizard with presets, progress board, managers run their own staff/pay/legends (GM told about pay changes), Excel import, invite status/resend and printable slips, staffing needs per location (weekday/season/date) with gaps in the schedule, timeline, publish, dashboard and budgets; staff and managers see pay only. Migration 0008.
