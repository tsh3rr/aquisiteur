-- Hand-written: tenant-role privileges for the phase 3 tables (see 0002).
-- Members answer chats, close threads and handle callbacks from the cockpit.
-- Visitors write through the public routes (system connection, scoped to
-- the host's workspace).
GRANT SELECT, INSERT, UPDATE ON chat_threads, chat_messages, callback_requests TO aquisiteur_app;
--> statement-breakpoint
GRANT SELECT ON chat_drafts TO aquisiteur_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON member_presence TO aquisiteur_app;
