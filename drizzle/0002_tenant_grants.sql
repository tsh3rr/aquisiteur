-- Hand-written: table privileges for the tenant role. RLS decides which rows
-- are visible; these grants decide which statements are possible at all.
-- New workspace-scoped tables must be added here (a DB test enforces that
-- every table with workspace_id has RLS enabled and a policy).

GRANT SELECT, INSERT, UPDATE, DELETE ON
  workspace_settings, domains, integrations, api_tokens, memberships
  TO aquisiteur_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON workspaces TO aquisiteur_app;
--> statement-breakpoint
-- Append-only from the tenant's point of view.
GRANT SELECT, INSERT ON audit_log, usage_events TO aquisiteur_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE audit_log_id_seq, usage_events_id_seq TO aquisiteur_app;
--> statement-breakpoint
GRANT SELECT (id, name, email, image) ON users TO aquisiteur_app;
--> statement-breakpoint
-- Auth internals (sessions, accounts, verifications, passkeys, rate_limits) and
-- platform_admins stay reserved to the system connection: no grants.
REVOKE ALL ON sessions, accounts, verifications, passkeys, rate_limits, platform_admins FROM aquisiteur_app;
