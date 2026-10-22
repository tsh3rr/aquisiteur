CREATE TYPE "public"."invoice_kind" AS ENUM('standard', 'deposit', 'final', 'cancellation');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'cancelled');--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_on" date NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"project_id" uuid,
	"offer_id" uuid,
	"milestone_id" text,
	"kind" "invoice_kind" DEFAULT 'standard' NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"number" text,
	"issue_date" date,
	"due_date" date,
	"document" jsonb NOT NULL,
	"totals" jsonb,
	"issuer" jsonb,
	"recipient" jsonb,
	"tax_note" text,
	"sha256" text,
	"cancels_invoice_id" uuid,
	"issued_at" timestamp with time zone,
	"issued_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "billing" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_fk" FOREIGN KEY ("workspace_id","invoice_id") REFERENCES "public"."invoices"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancels_invoice_id_invoices_id_fk" FOREIGN KEY ("cancels_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_offer_fk" FOREIGN KEY ("workspace_id","offer_id") REFERENCES "public"."offers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("workspace_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_workspace_number_idx" ON "invoices" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "invoices_prospect_idx" ON "invoices" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
CREATE INDEX "invoices_project_idx" ON "invoices" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "invoices_offer_idx" ON "invoices" USING btree ("workspace_id","offer_id");--> statement-breakpoint
CREATE INDEX "invoices_issue_date_idx" ON "invoices" USING btree ("workspace_id","issue_date");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "invoice_payments" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("invoice_payments"."workspace_id" = app.current_workspace_id() and app.is_member("invoice_payments"."workspace_id")) WITH CHECK ("invoice_payments"."workspace_id" = app.current_workspace_id() and app.is_member("invoice_payments"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "invoices" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("invoices"."workspace_id" = app.current_workspace_id() and app.is_member("invoices"."workspace_id")) WITH CHECK ("invoices"."workspace_id" = app.current_workspace_id() and app.is_member("invoices"."workspace_id"));