ALTER TYPE "public"."outbound_email_kind" ADD VALUE 'reminder';--> statement-breakpoint
CREATE TABLE "invoice_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"as_of" date NOT NULL,
	"deadline" date NOT NULL,
	"open_cents" integer NOT NULL,
	"interest_cents" integer DEFAULT 0 NOT NULL,
	"interest_rate_bp" integer,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_reminders_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "invoice_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reminder_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "reminder_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD CONSTRAINT "invoice_reminders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD CONSTRAINT "invoice_reminders_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD CONSTRAINT "invoice_reminders_invoice_fk" FOREIGN KEY ("workspace_id","invoice_id") REFERENCES "public"."invoices"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_reminders_invoice_level_idx" ON "invoice_reminders" USING btree ("invoice_id","level");--> statement-breakpoint
CREATE INDEX "invoice_reminders_workspace_idx" ON "invoice_reminders" USING btree ("workspace_id","invoice_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reminder_fk" FOREIGN KEY ("workspace_id","reminder_id") REFERENCES "public"."invoice_reminders"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_reminder_fk" FOREIGN KEY ("workspace_id","reminder_id") REFERENCES "public"."invoice_reminders"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_invoice_reminder_idx" ON "tasks" USING btree ("workspace_id","reminder_id");--> statement-breakpoint
CREATE INDEX "outbound_emails_reminder_idx" ON "outbound_emails" USING btree ("workspace_id","reminder_id");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "invoice_reminders" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("invoice_reminders"."workspace_id" = app.current_workspace_id() and app.is_member("invoice_reminders"."workspace_id")) WITH CHECK ("invoice_reminders"."workspace_id" = app.current_workspace_id() and app.is_member("invoice_reminders"."workspace_id"));