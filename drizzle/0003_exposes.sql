CREATE TYPE "public"."prospect_status" AS ENUM('draft', 'letter_sent', 'opened', 'interested', 'contacted', 'meeting', 'won', 'lost', 'no_interest');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('image', 'video', 'captions');--> statement-breakpoint
CREATE TYPE "public"."publish_source" AS ENUM('api', 'cockpit', 'seed');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"salutation" text,
	"first_name" text,
	"last_name" text,
	"role" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"company_name" text NOT NULL,
	"industry" text,
	"website" text,
	"street" text,
	"postal_code" text,
	"city" text,
	"country" text DEFAULT 'DE' NOT NULL,
	"phone" text,
	"email" text,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "prospect_status" DEFAULT 'draft' NOT NULL,
	"do_not_contact_at" timestamp with time zone,
	"estimated_value_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospects_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "prospects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"original_name" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" bigint NOT NULL,
	"variants" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expose_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"expose_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"asset_manifest" jsonb NOT NULL,
	"source" "publish_source" NOT NULL,
	"published_by_user_id" text,
	"api_token_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expose_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exposes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"ref_code" text NOT NULL,
	"title" text NOT NULL,
	"current_version_id" uuid,
	"unpublished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exposes_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "exposes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expose_versions" ADD CONSTRAINT "expose_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expose_versions" ADD CONSTRAINT "expose_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expose_versions" ADD CONSTRAINT "expose_versions_api_token_id_api_tokens_id_fk" FOREIGN KEY ("api_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expose_versions" ADD CONSTRAINT "expose_versions_expose_fk" FOREIGN KEY ("workspace_id","expose_id") REFERENCES "public"."exposes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposes" ADD CONSTRAINT "exposes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposes" ADD CONSTRAINT "exposes_current_version_id_expose_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."expose_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposes" ADD CONSTRAINT "exposes_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_prospect_idx" ON "contacts" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_workspace_key_idx" ON "prospects" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "prospects_workspace_status_idx" ON "prospects" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_workspace_sha_idx" ON "assets" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "expose_versions_expose_version_idx" ON "expose_versions" USING btree ("expose_id","version");--> statement-breakpoint
CREATE INDEX "expose_versions_workspace_idx" ON "expose_versions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exposes_workspace_slug_idx" ON "exposes" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "exposes_workspace_ref_idx" ON "exposes" USING btree ("workspace_id","ref_code");--> statement-breakpoint
CREATE UNIQUE INDEX "exposes_workspace_prospect_idx" ON "exposes" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "contacts" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("contacts"."workspace_id" = app.current_workspace_id() and app.is_member("contacts"."workspace_id")) WITH CHECK ("contacts"."workspace_id" = app.current_workspace_id() and app.is_member("contacts"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "prospects" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("prospects"."workspace_id" = app.current_workspace_id() and app.is_member("prospects"."workspace_id")) WITH CHECK ("prospects"."workspace_id" = app.current_workspace_id() and app.is_member("prospects"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "assets" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("assets"."workspace_id" = app.current_workspace_id() and app.is_member("assets"."workspace_id")) WITH CHECK ("assets"."workspace_id" = app.current_workspace_id() and app.is_member("assets"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "expose_versions" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("expose_versions"."workspace_id" = app.current_workspace_id() and app.is_member("expose_versions"."workspace_id")) WITH CHECK ("expose_versions"."workspace_id" = app.current_workspace_id() and app.is_member("expose_versions"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "exposes" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("exposes"."workspace_id" = app.current_workspace_id() and app.is_member("exposes"."workspace_id")) WITH CHECK ("exposes"."workspace_id" = app.current_workspace_id() and app.is_member("exposes"."workspace_id"));