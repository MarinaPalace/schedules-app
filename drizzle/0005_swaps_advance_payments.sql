CREATE TABLE "advance_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advance_payments_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "swap_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"colleague_id" uuid NOT NULL,
	"date1" date NOT NULL,
	"date2" date,
	"snapshot" jsonb NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD COLUMN "swap_request_id" uuid;--> statement-breakpoint
ALTER TABLE "advance_payments" ADD CONSTRAINT "advance_payments_request_id_advance_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."advance_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_payments" ADD CONSTRAINT "advance_payments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_events" ADD CONSTRAINT "swap_events_request_id_swap_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."swap_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_events" ADD CONSTRAINT "swap_events_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_requester_id_employees_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_colleague_id_employees_id_fk" FOREIGN KEY ("colleague_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "swap_events_request_idx" ON "swap_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "swap_requests_dept_idx" ON "swap_requests" USING btree ("department_id","created_at");--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_swap_request_id_swap_requests_id_fk" FOREIGN KEY ("swap_request_id") REFERENCES "public"."swap_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A swap is accepted at most once and ends at most once (also guards against double clicks / races).
CREATE UNIQUE INDEX "swap_events_accepted_uq" ON "swap_events" ("request_id") WHERE "action" = 'accepted';--> statement-breakpoint
CREATE UNIQUE INDEX "swap_events_final_uq" ON "swap_events" ("request_id") WHERE "action" IN ('declined', 'cancelled', 'approved', 'rejected');--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['swap_requests', 'swap_events', 'advance_payments'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_block_delete()', t || '_no_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION app_block_delete()', t || '_no_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app_block_update()', t || '_no_update', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app_audit()', t || '_audit', t);
  END LOOP;
END;
$$;
