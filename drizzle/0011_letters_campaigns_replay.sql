CREATE TYPE "public"."letter_kind" AS ENUM('initial', 'follow_up');--> statement-breakpoint
CREATE TYPE "public"."letter_status" AS ENUM('draft', 'queued', 'submitted', 'printed', 'posted', 'returned', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."consent_decision" AS ENUM('given', 'denied', 'withdrawn');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"campaign_id" uuid,
	"touchpoint_id" uuid NOT NULL,
	"kind" "letter_kind" DEFAULT 'initial' NOT NULL,
	"status" "letter_status" DEFAULT 'draft' NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_ref" text,
	"options" jsonb NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"cost_cents" integer,
	"failure_reason" text,
	"queued_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"printed_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "letters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"scope" text DEFAULT 'replay' NOT NULL,
	"decision" "consent_decision" NOT NULL,
	"notice_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session_replays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_chunk_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_replays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "letter" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_touchpoint_fk" FOREIGN KEY ("workspace_id","touchpoint_id") REFERENCES "public"."touchpoints"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_visit_fk" FOREIGN KEY ("workspace_id","visit_id") REFERENCES "public"."visits"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_replays" ADD CONSTRAINT "session_replays_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_replays" ADD CONSTRAINT "session_replays_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_replays" ADD CONSTRAINT "session_replays_visit_fk" FOREIGN KEY ("workspace_id","visit_id") REFERENCES "public"."visits"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_workspace_name_idx" ON "campaigns" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "letters_prospect_idx" ON "letters" USING btree ("workspace_id","prospect_id","created_at");--> statement-breakpoint
CREATE INDEX "letters_campaign_idx" ON "letters" USING btree ("workspace_id","campaign_id");--> statement-breakpoint
CREATE INDEX "letters_posted_idx" ON "letters" USING btree ("workspace_id","posted_at");--> statement-breakpoint
CREATE INDEX "consents_visit_idx" ON "consents" USING btree ("workspace_id","visit_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_replays_visit_idx" ON "session_replays" USING btree ("workspace_id","visit_id");--> statement-breakpoint
CREATE INDEX "session_replays_prospect_idx" ON "session_replays" USING btree ("workspace_id","prospect_id","started_at");--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospects_campaign_idx" ON "prospects" USING btree ("workspace_id","campaign_id");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "campaigns" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("campaigns"."workspace_id" = app.current_workspace_id() and app.is_member("campaigns"."workspace_id")) WITH CHECK ("campaigns"."workspace_id" = app.current_workspace_id() and app.is_member("campaigns"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "letters" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("letters"."workspace_id" = app.current_workspace_id() and app.is_member("letters"."workspace_id")) WITH CHECK ("letters"."workspace_id" = app.current_workspace_id() and app.is_member("letters"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "consents" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("consents"."workspace_id" = app.current_workspace_id() and app.is_member("consents"."workspace_id")) WITH CHECK ("consents"."workspace_id" = app.current_workspace_id() and app.is_member("consents"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "session_replays" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("session_replays"."workspace_id" = app.current_workspace_id() and app.is_member("session_replays"."workspace_id")) WITH CHECK ("session_replays"."workspace_id" = app.current_workspace_id() and app.is_member("session_replays"."workspace_id"));