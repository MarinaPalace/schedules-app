DROP INDEX "timesheet_entries_lookup_idx";--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "break_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD COLUMN "break_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD COLUMN "break_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_entries_version_uq" ON "timesheet_entries" USING btree ("employee_id","work_date","version");