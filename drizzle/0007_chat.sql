CREATE TYPE "public"."availability" AS ENUM('auto', 'available', 'away');--> statement-breakpoint
CREATE TYPE "public"."callback_status" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TYPE "public"."chat_author" AS ENUM('visitor', 'owner', 'system');--> statement-breakpoint
CREATE TYPE "public"."chat_message_kind" AS ENUM('text', 'handover', 'offline');--> statement-breakpoint
CREATE TYPE "public"."chat_thread_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."return_channel" AS ENUM('email', 'phone', 'whatsapp');--> statement-breakpoint
CREATE TABLE "callback_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"expose_id" uuid NOT NULL,
	"visit_id" uuid,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"preferred_time" text,
	"note" text,
	"status" "callback_status" DEFAULT 'open' NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "callback_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"thread_id" uuid,
	"length" integer DEFAULT 0 NOT NULL,
	"max_length" integer DEFAULT 0 NOT NULL,
	"content" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"author" "chat_author" NOT NULL,
	"author_user_id" text,
	"kind" "chat_message_kind" DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"visit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"expose_id" uuid NOT NULL,
	"visit_id" uuid,
	"status" "chat_thread_status" DEFAULT 'open' NOT NULL,
	"visitor_name" text,
	"visitor_email" text,
	"visitor_phone" text,
	"return_channel" "return_channel",
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_visitor_message_at" timestamp with time zone,
	"last_owner_message_at" timestamp with time zone,
	"owner_read_at" timestamp with time zone,
	"offline_notice_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_threads_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "chat_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_presence" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"availability" "availability" DEFAULT 'auto' NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_presence_pkey" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "member_presence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "chat" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_done_by_user_id_users_id_fk" FOREIGN KEY ("done_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_expose_fk" FOREIGN KEY ("workspace_id","expose_id") REFERENCES "public"."exposes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_visit_fk" FOREIGN KEY ("workspace_id","visit_id") REFERENCES "public"."visits"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_drafts" ADD CONSTRAINT "chat_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_drafts" ADD CONSTRAINT "chat_drafts_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_drafts" ADD CONSTRAINT "chat_drafts_visit_fk" FOREIGN KEY ("workspace_id","visit_id") REFERENCES "public"."visits"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_drafts" ADD CONSTRAINT "chat_drafts_thread_fk" FOREIGN KEY ("workspace_id","thread_id") REFERENCES "public"."chat_threads"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_fk" FOREIGN KEY ("workspace_id","thread_id") REFERENCES "public"."chat_threads"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_visit_fk" FOREIGN KEY ("workspace_id","visit_id") REFERENCES "public"."visits"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_expose_fk" FOREIGN KEY ("workspace_id","expose_id") REFERENCES "public"."exposes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_visit_fk" FOREIGN KEY ("workspace_id","visit_id") REFERENCES "public"."visits"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_presence" ADD CONSTRAINT "member_presence_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_presence" ADD CONSTRAINT "member_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "callback_requests_status_idx" ON "callback_requests" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "callback_requests_prospect_idx" ON "callback_requests" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_drafts_visit_idx" ON "chat_drafts" USING btree ("workspace_id","visit_id");--> statement-breakpoint
CREATE INDEX "chat_drafts_prospect_idx" ON "chat_drafts" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
CREATE INDEX "chat_messages_thread_idx" ON "chat_messages" USING btree ("workspace_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_threads_recent_idx" ON "chat_threads" USING btree ("workspace_id","last_message_at");--> statement-breakpoint
CREATE INDEX "chat_threads_prospect_idx" ON "chat_threads" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "callback_requests" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("callback_requests"."workspace_id" = app.current_workspace_id() and app.is_member("callback_requests"."workspace_id")) WITH CHECK ("callback_requests"."workspace_id" = app.current_workspace_id() and app.is_member("callback_requests"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "chat_drafts" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("chat_drafts"."workspace_id" = app.current_workspace_id() and app.is_member("chat_drafts"."workspace_id")) WITH CHECK ("chat_drafts"."workspace_id" = app.current_workspace_id() and app.is_member("chat_drafts"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "chat_messages" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("chat_messages"."workspace_id" = app.current_workspace_id() and app.is_member("chat_messages"."workspace_id")) WITH CHECK ("chat_messages"."workspace_id" = app.current_workspace_id() and app.is_member("chat_messages"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "chat_threads" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("chat_threads"."workspace_id" = app.current_workspace_id() and app.is_member("chat_threads"."workspace_id")) WITH CHECK ("chat_threads"."workspace_id" = app.current_workspace_id() and app.is_member("chat_threads"."workspace_id"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "member_presence" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("member_presence"."workspace_id" = app.current_workspace_id() and app.is_member("member_presence"."workspace_id")) WITH CHECK ("member_presence"."workspace_id" = app.current_workspace_id() and app.is_member("member_presence"."workspace_id"));