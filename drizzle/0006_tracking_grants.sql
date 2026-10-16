-- Hand-written: tenant-role privileges for the phase 2 tables (see 0002).
GRANT SELECT, INSERT, UPDATE ON touchpoints TO aquisiteur_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_views TO aquisiteur_app;
--> statement-breakpoint
-- Visits and events are written by the public ingestion (system connection,
-- scoped to the host's workspace). Members only read them; deletion is a
-- system job (retention, data subject requests, phase 6).
GRANT SELECT ON visits, events TO aquisiteur_app;
