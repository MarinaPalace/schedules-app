CREATE TABLE "schedule_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_publications" ADD CONSTRAINT "schedule_publications_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_publications" ADD CONSTRAINT "schedule_publications_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_publications_dept_idx" ON "schedule_publications" USING btree ("department_id","from_date","to_date");--> statement-breakpoint
CREATE TRIGGER schedule_publications_no_delete BEFORE DELETE ON schedule_publications FOR EACH ROW EXECUTE FUNCTION app_block_delete();
--> statement-breakpoint
CREATE TRIGGER schedule_publications_no_truncate BEFORE TRUNCATE ON schedule_publications FOR EACH STATEMENT EXECUTE FUNCTION app_block_delete();
--> statement-breakpoint
CREATE TRIGGER schedule_publications_no_update BEFORE UPDATE ON schedule_publications FOR EACH ROW EXECUTE FUNCTION app_block_update();
--> statement-breakpoint
CREATE TRIGGER schedule_publications_audit AFTER INSERT OR UPDATE ON schedule_publications FOR EACH ROW EXECUTE FUNCTION app_audit();
