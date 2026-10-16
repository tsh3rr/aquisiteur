-- Hand-written: tenant-role privileges for the phase 5 tables (see 0002).
-- Consents and replays are written by the public exposé on the system
-- connection; tenants read them and may delete (data subject requests).
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO aquisiteur_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON letters TO aquisiteur_app;
--> statement-breakpoint
GRANT SELECT, DELETE ON consents TO aquisiteur_app;
--> statement-breakpoint
GRANT SELECT, DELETE ON session_replays TO aquisiteur_app;
