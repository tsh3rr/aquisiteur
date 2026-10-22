CREATE TYPE "public"."email_status" AS ENUM('sending', 'sent', 'delayed', 'delivered', 'bounced', 'complained', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outbound_email_kind" AS ENUM('invoice');--> statement-breakpoint
CREATE TABLE "invoice_shares" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token" text NOT NULL,
	"pdf_key" text,
	"pdf_bytes" integer,
	"first_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "outbound_email_kind" NOT NULL,
	"prospect_id" uuid NOT NULL,
	"project_id" uuid,
	"invoice_id" uuid,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"message_id" text NOT NULL,
	"provider_id" text,
	"status" "email_status" DEFAULT 'sending' NOT NULL,
	"status_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"attachment_bytes" integer,
	"sent_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_shares" ADD CONSTRAINT "invoice_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_shares" ADD CONSTRAINT "invoice_shares_invoice_fk" FOREIGN KEY ("workspace_id","invoice_id") REFERENCES "public"."invoices"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_invoice_fk" FOREIGN KEY ("workspace_id","invoice_id") REFERENCES "public"."invoices"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_shares_token_idx" ON "invoice_shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invoice_shares_workspace_idx" ON "invoice_shares" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "outbound_emails_prospect_idx" ON "outbound_emails" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
CREATE INDEX "outbound_emails_invoice_idx" ON "outbound_emails" USING btree ("workspace_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_emails_provider_idx" ON "outbound_emails" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_emails_message_idx" ON "outbound_emails" USING btree ("message_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_invoice_fk" FOREIGN KEY ("workspace_id","invoice_id") REFERENCES "public"."invoices"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_invoice_idx" ON "tasks" USING btree ("workspace_id","invoice_id");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "invoice_shares" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("invoice_shares"."workspace_id" = app.current_workspace_id() and app.is_member("invoice_shares"."workspace_id")) WITH CHECK ("invoice_shares"."workspace_id" = app.current_workspace_id() and app.is_member("invoice_shares"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "outbound_emails" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("outbound_emails"."workspace_id" = app.current_workspace_id() and app.is_member("outbound_emails"."workspace_id")) WITH CHECK ("outbound_emails"."workspace_id" = app.current_workspace_id() and app.is_member("outbound_emails"."workspace_id"));