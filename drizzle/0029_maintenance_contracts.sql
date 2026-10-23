CREATE TABLE "maintenance_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"project_id" uuid,
	"offer_id" uuid,
	"title" text NOT NULL,
	"interval" "billing_interval" NOT NULL,
	"timing" text DEFAULT 'advance' NOT NULL,
	"lines" jsonb NOT NULL,
	"start_date" date,
	"minimum_months" integer DEFAULT 0 NOT NULL,
	"notice_months" integer DEFAULT 0 NOT NULL,
	"notice_received_on" date,
	"end_date" date,
	"send_mode" text,
	"billed_until" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_contracts_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "contract_period_from" date;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_offer_fk" FOREIGN KEY ("workspace_id","offer_id") REFERENCES "public"."offers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_contracts_offer_interval_idx" ON "maintenance_contracts" USING btree ("offer_id","interval");--> statement-breakpoint
CREATE INDEX "maintenance_contracts_prospect_idx" ON "maintenance_contracts" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
CREATE INDEX "maintenance_contracts_project_idx" ON "maintenance_contracts" USING btree ("workspace_id","project_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."maintenance_contracts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_contract_period_idx" ON "invoices" USING btree ("contract_id","contract_period_from") WHERE "invoices"."kind" <> 'cancellation';--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "maintenance_contracts" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("maintenance_contracts"."workspace_id" = app.current_workspace_id() and app.is_member("maintenance_contracts"."workspace_id")) WITH CHECK ("maintenance_contracts"."workspace_id" = app.current_workspace_id() and app.is_member("maintenance_contracts"."workspace_id"));