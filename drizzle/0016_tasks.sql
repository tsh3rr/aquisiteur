CREATE TYPE "public"."task_reminder" AS ENUM('none', 'at_due', 'hour_before', 'day_before');--> statement-breakpoint
ALTER TYPE "public"."notification_trigger" ADD VALUE 'task_due';--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"due_date" date NOT NULL,
	"due_time" text,
	"reminder" "task_reminder" DEFAULT 'at_due' NOT NULL,
	"remind_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_open_idx" ON "tasks" USING btree ("workspace_id","due_date","due_time") WHERE "tasks"."done_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_prospect_idx" ON "tasks" USING btree ("workspace_id","prospect_id");--> statement-breakpoint
CREATE INDEX "tasks_reminder_idx" ON "tasks" USING btree ("remind_at") WHERE "tasks"."reminded_at" is null and "tasks"."done_at" is null;--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "tasks" AS PERMISSIVE FOR ALL TO "aquisiteur_app" USING ("tasks"."workspace_id" = app.current_workspace_id() and app.is_member("tasks"."workspace_id")) WITH CHECK ("tasks"."workspace_id" = app.current_workspace_id() and app.is_member("tasks"."workspace_id"));