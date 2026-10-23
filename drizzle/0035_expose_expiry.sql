ALTER TABLE "workspace_settings" ADD COLUMN "expose_expiry" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "exposes" ADD COLUMN "expiry_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "on_expired_page" boolean DEFAULT false NOT NULL;