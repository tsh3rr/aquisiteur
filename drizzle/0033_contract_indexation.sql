ALTER TYPE "public"."outbound_email_kind" ADD VALUE 'contract_notice';--> statement-breakpoint
CREATE TABLE "contract_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"status" text NOT NULL,
	"base_month" text NOT NULL,
	"base_tenths" integer NOT NULL,
	"index_month" text NOT NULL,
	"index_tenths" integer NOT NULL,
	"change_bp" integer NOT NULL,
	"effective_from" date,
	"old_lines" jsonb NOT NULL,
	"new_lines" jsonb NOT NULL,
	"announced_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_adjustments_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "contract_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contract_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"description" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD COLUMN "indexed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD COLUMN "index_month" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD COLUMN "index_base_month" text;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD COLUMN "index_base_tenths" integer;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD COLUMN "index_threshold_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD COLUMN "included_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD COLUMN "hourly_rate_cents" integer;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD COLUMN "overage_billed_until" date;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_adjustments" ADD CONSTRAINT "contract_adjustments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_adjustments" ADD CONSTRAINT "contract_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_adjustments" ADD CONSTRAINT "contract_adjustments_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."maintenance_contracts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_time_entries" ADD CONSTRAINT "contract_time_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_time_entries" ADD CONSTRAINT "contract_time_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_time_entries" ADD CONSTRAINT "contract_time_entries_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."maintenance_contracts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_adjustments_cycle_idx" ON "contract_adjustments" USING btree ("contract_id","due_on") WHERE "contract_adjustments"."status" <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "contract_adjustments_contract_idx" ON "contract_adjustments" USING btree ("workspace_id","contract_id");--> statement-breakpoint
CREATE INDEX "contract_time_entries_contract_idx" ON "contract_time_entries" USING btree ("workspace_id","contract_id","work_date");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."maintenance_contracts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."maintenance_contracts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_contract_idx" ON "tasks" USING btree ("workspace_id","contract_id");--> statement-breakpoint
CREATE INDEX "outbound_emails_contract_idx" ON "outbound_emails" USING btree ("workspace_id","contract_id");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "contract_adjustments" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("contract_adjustments"."workspace_id" = app.current_workspace_id() and app.is_member("contract_adjustments"."workspace_id")) WITH CHECK ("contract_adjustments"."workspace_id" = app.current_workspace_id() and app.is_member("contract_adjustments"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "contract_time_entries" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("contract_time_entries"."workspace_id" = app.current_workspace_id() and app.is_member("contract_time_entries"."workspace_id")) WITH CHECK ("contract_time_entries"."workspace_id" = app.current_workspace_id() and app.is_member("contract_time_entries"."workspace_id"));