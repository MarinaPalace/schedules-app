CREATE TABLE "login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "telegram_name" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "locale" text DEFAULT 'bg' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "notify_telegram" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "login_tokens" ADD CONSTRAINT "login_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_tokens" ADD CONSTRAINT "login_tokens_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_tokens_user_idx" ON "login_tokens" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_telegram_chat_id_unique" UNIQUE("telegram_chat_id");--> statement-breakpoint
-- Links: never deleted; the only allowed change is marking one as used. Delivery log: insert only.
CREATE FUNCTION app_token_use_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.used_at IS NOT NULL OR NEW.used_at IS NULL OR
     (to_jsonb(NEW) - 'used_at') IS DISTINCT FROM (to_jsonb(OLD) - 'used_at') THEN
    RAISE EXCEPTION 'A login link can only be marked as used once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER login_tokens_use_only BEFORE UPDATE ON login_tokens FOR EACH ROW EXECUTE FUNCTION app_token_use_only();--> statement-breakpoint
CREATE TRIGGER login_tokens_no_delete BEFORE DELETE ON login_tokens FOR EACH ROW EXECUTE FUNCTION app_block_delete();--> statement-breakpoint
CREATE TRIGGER login_tokens_no_truncate BEFORE TRUNCATE ON login_tokens FOR EACH STATEMENT EXECUTE FUNCTION app_block_delete();--> statement-breakpoint
CREATE TRIGGER login_tokens_audit AFTER INSERT OR UPDATE ON login_tokens FOR EACH ROW EXECUTE FUNCTION app_audit();--> statement-breakpoint
CREATE TRIGGER notifications_no_delete BEFORE DELETE ON notifications FOR EACH ROW EXECUTE FUNCTION app_block_delete();--> statement-breakpoint
CREATE TRIGGER notifications_no_truncate BEFORE TRUNCATE ON notifications FOR EACH STATEMENT EXECUTE FUNCTION app_block_delete();--> statement-breakpoint
CREATE TRIGGER notifications_no_update BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION app_block_update();
