-- Hand-written: tenant-role privileges for the phase 1 tables (see 0002).
GRANT SELECT, INSERT, UPDATE, DELETE ON prospects, contacts, exposes TO aquisiteur_app;
--> statement-breakpoint
-- Versions and assets are immutable once written; cleanup runs as a system job (phase 6).
GRANT SELECT, INSERT ON expose_versions, assets TO aquisiteur_app;
