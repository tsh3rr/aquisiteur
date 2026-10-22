CREATE TYPE "public"."billing_interval" AS ENUM('once', 'monthly', 'quarterly', 'halfyearly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('idea', 'offered', 'ordered', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."notification_trigger" ADD VALUE 'offer_viewed';--> statement-breakpoint
ALTER TYPE "public"."notification_trigger" ADD VALUE 'offer_answered';--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit" text DEFAULT 'Pauschal' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"billing" "billing_interval" DEFAULT 'once' NOT NULL,
	"vat_rate" integer DEFAULT 20 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "number_series" (
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"year" integer NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_series_workspace_id_kind_year_pk" PRIMARY KEY("workspace_id","kind","year")
);
--> statement-breakpoint
ALTER TABLE "number_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "offer_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"tax_mode" text NOT NULL,
	"tax_note" text NOT NULL,
	"sha256" text NOT NULL,
	"valid_until" date NOT NULL,
	"sent_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offer_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"number" text,
	"title" text NOT NULL,
	"status" "offer_status" DEFAULT 'draft' NOT NULL,
	"draft" jsonb NOT NULL,
	"current_version_id" uuid,
	"public_token" text NOT NULL,
	"sent_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone,
	"acceptance" jsonb,
	"decline_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'idea' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "billing" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "exposes" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_offer_fk" FOREIGN KEY ("workspace_id","offer_id") REFERENCES "public"."offers"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_current_version_id_offer_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."offer_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_items_workspace_idx" ON "catalog_items" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_versions_offer_version_idx" ON "offer_versions" USING btree ("offer_id","version");--> statement-breakpoint
CREATE INDEX "offer_versions_workspace_idx" ON "offer_versions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_public_token_idx" ON "offers" USING btree ("public_token");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_workspace_number_idx" ON "offers" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "offers_project_idx" ON "offers" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "offers_prospect_idx" ON "offers" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
CREATE INDEX "projects_prospect_idx" ON "projects" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
ALTER TABLE "exposes" ADD CONSTRAINT "exposes_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exposes_project_idx" ON "exposes" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "catalog_items" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("catalog_items"."workspace_id" = app.current_workspace_id() and app.is_member("catalog_items"."workspace_id")) WITH CHECK ("catalog_items"."workspace_id" = app.current_workspace_id() and app.is_member("catalog_items"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "number_series" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("number_series"."workspace_id" = app.current_workspace_id() and app.is_member("number_series"."workspace_id")) WITH CHECK ("number_series"."workspace_id" = app.current_workspace_id() and app.is_member("number_series"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "offer_versions" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("offer_versions"."workspace_id" = app.current_workspace_id() and app.is_member("offer_versions"."workspace_id")) WITH CHECK ("offer_versions"."workspace_id" = app.current_workspace_id() and app.is_member("offer_versions"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "offers" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("offers"."workspace_id" = app.current_workspace_id() and app.is_member("offers"."workspace_id")) WITH CHECK ("offers"."workspace_id" = app.current_workspace_id() and app.is_member("offers"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "projects" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("projects"."workspace_id" = app.current_workspace_id() and app.is_member("projects"."workspace_id")) WITH CHECK ("projects"."workspace_id" = app.current_workspace_id() and app.is_member("projects"."workspace_id"));