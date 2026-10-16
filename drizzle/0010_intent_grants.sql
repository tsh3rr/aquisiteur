-- Hand-written: tenant-role privileges for the phase 4 tables (see 0002),
-- plus the default notification rules (§7.7) for existing workspaces.
-- New workspaces get the same rules from src/server/workspaces.ts.
GRANT SELECT, INSERT, UPDATE ON intent_scores TO aquisiteur_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_rules TO aquisiteur_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON notifications TO aquisiteur_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO aquisiteur_app;
--> statement-breakpoint
INSERT INTO notification_rules (workspace_id, trigger, threshold, channels)
SELECT w.id, r.trigger::notification_trigger, r.threshold, r.channels::notification_channel[]
FROM workspaces w
CROSS JOIN (VALUES
  ('first_visit', NULL::integer, '{push}'),
  ('chat_message', NULL::integer, '{push}'),
  ('score_threshold', 50, '{push,email}'),
  ('daily_digest', 8, '{email}')
) AS r(trigger, threshold, channels)
WHERE NOT EXISTS (SELECT 1 FROM notification_rules n WHERE n.workspace_id = w.id);
