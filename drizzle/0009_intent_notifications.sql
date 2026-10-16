CREATE TYPE "public"."intent_level" AS ENUM('curious', 'interested', 'likely', 'very_likely', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('push', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_trigger" AS ENUM('first_visit', 'return_visit', 'chat_message', 'callback', 'score_threshold', 'opt_out', 'daily_digest');--> statement-breakpoint
CREATE TABLE "intent_scores" (
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"level" "intent_level" DEFAULT 'curious' NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"explanation" jsonb NOT NULL,
	"last_signal_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intent_scores_pkey" PRIMARY KEY("workspace_id","prospect_id")
);
--> statement-breakpoint
ALTER TABLE "intent_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trigger" "notification_trigger" NOT NULL,
	"threshold" integer,
	"channels" "notification_channel"[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"quiet_from" text,
	"quiet_to" text,
	"weekdays_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_id" uuid,
	"prospect_id" uuid,
	"trigger" "notification_trigger" NOT NULL,
	"group_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"channels" "notification_channel"[] DEFAULT '{}' NOT NULL,
	"suppressed" text,
	"pushed_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "notifications" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "intent_scores" ADD CONSTRAINT "intent_scores_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_scores" ADD CONSTRAINT "intent_scores_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_rule_id_notification_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."notification_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intent_scores_rank_idx" ON "intent_scores" USING btree ("workspace_id","score","last_signal_at");--> statement-breakpoint
CREATE INDEX "notification_rules_workspace_idx" ON "notification_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "notifications_recent_idx" ON "notifications" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_group_idx" ON "notifications" USING btree ("workspace_id","group_key","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("workspace_id","endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "intent_scores" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("intent_scores"."workspace_id" = app.current_workspace_id() and app.is_member("intent_scores"."workspace_id")) WITH CHECK ("intent_scores"."workspace_id" = app.current_workspace_id() and app.is_member("intent_scores"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "notification_rules" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("notification_rules"."workspace_id" = app.current_workspace_id() and app.is_member("notification_rules"."workspace_id")) WITH CHECK ("notification_rules"."workspace_id" = app.current_workspace_id() and app.is_member("notification_rules"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("notifications"."workspace_id" = app.current_workspace_id() and app.is_member("notifications"."workspace_id")) WITH CHECK ("notifications"."workspace_id" = app.current_workspace_id() and app.is_member("notifications"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "push_subscriptions" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("push_subscriptions"."workspace_id" = app.current_workspace_id() and app.is_member("push_subscriptions"."workspace_id")) WITH CHECK ("push_subscriptions"."workspace_id" = app.current_workspace_id() and app.is_member("push_subscriptions"."workspace_id"));