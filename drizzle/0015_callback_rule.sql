-- Callback requests notify by push, like chat messages (DEFAULT_RULES in
-- src/domain/notifications.ts). Older workspaces had no rule for them, so a
-- request from an exposé reached the chat page but never the owner.
INSERT INTO notification_rules (workspace_id, trigger, threshold, channels)
SELECT w.id, 'callback'::notification_trigger, NULL, '{push}'::notification_channel[]
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM notification_rules n WHERE n.workspace_id = w.id AND n.trigger = 'callback'
);
