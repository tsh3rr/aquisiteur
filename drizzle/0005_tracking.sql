CREATE TYPE "public"."device_type" AS ENUM('mobile', 'tablet', 'desktop', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."touchpoint_channel" AS ENUM('letter', 'share', 'manual');--> statement-breakpoint
CREATE TYPE "public"."visit_source" AS ENUM('qr', 'typed', 'direct', 'share');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"expose_id" uuid NOT NULL,
	"type" text NOT NULL,
	"block_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "touchpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"expose_id" uuid NOT NULL,
	"channel" "touchpoint_channel" NOT NULL,
	"label" text NOT NULL,
	"qr_token" text NOT NULL,
	"short_code" text,
	"parent_visit_id" uuid,
	"created_by_user_id" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "touchpoints_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "touchpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"expose_id" uuid NOT NULL,
	"touchpoint_id" uuid,
	"source" "visit_source" NOT NULL,
	"device" "device_type" DEFAULT 'unknown' NOT NULL,
	"browser" text,
	"os" text,
	"city" text,
	"country" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"bot_reason" text,
	"is_internal" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"max_scroll" integer DEFAULT 0 NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "visits_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_visit_fk" FOREIGN KEY ("workspace_id","visit_id") REFERENCES "public"."visits"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_expose_fk" FOREIGN KEY ("workspace_id","expose_id") REFERENCES "public"."exposes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_expose_fk" FOREIGN KEY ("workspace_id","expose_id") REFERENCES "public"."exposes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_touchpoint_fk" FOREIGN KEY ("workspace_id","touchpoint_id") REFERENCES "public"."touchpoints"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_expose_time_idx" ON "events" USING btree ("expose_id","created_at");--> statement-breakpoint
CREATE INDEX "events_visit_idx" ON "events" USING btree ("workspace_id","visit_id","occurred_at");--> statement-breakpoint
CREATE INDEX "saved_views_workspace_idx" ON "saved_views" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "touchpoints_qr_token_idx" ON "touchpoints" USING btree ("workspace_id","qr_token");--> statement-breakpoint
CREATE UNIQUE INDEX "touchpoints_short_code_idx" ON "touchpoints" USING btree ("workspace_id","short_code");--> statement-breakpoint
CREATE INDEX "touchpoints_prospect_idx" ON "touchpoints" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
CREATE INDEX "visits_prospect_idx" ON "visits" USING btree ("workspace_id","prospect_id","started_at");--> statement-breakpoint
CREATE INDEX "visits_expose_idx" ON "visits" USING btree ("expose_id","started_at");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "events" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("events"."workspace_id" = app.current_workspace_id() and app.is_member("events"."workspace_id")) WITH CHECK ("events"."workspace_id" = app.current_workspace_id() and app.is_member("events"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "saved_views" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("saved_views"."workspace_id" = app.current_workspace_id() and app.is_member("saved_views"."workspace_id")) WITH CHECK ("saved_views"."workspace_id" = app.current_workspace_id() and app.is_member("saved_views"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "touchpoints" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("touchpoints"."workspace_id" = app.current_workspace_id() and app.is_member("touchpoints"."workspace_id")) WITH CHECK ("touchpoints"."workspace_id" = app.current_workspace_id() and app.is_member("touchpoints"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "visits" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("visits"."workspace_id" = app.current_workspace_id() and app.is_member("visits"."workspace_id")) WITH CHECK ("visits"."workspace_id" = app.current_workspace_id() and app.is_member("visits"."workspace_id"));