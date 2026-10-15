-- Hand-written: tenant role and the helper functions RLS policies depend on.
-- Plain Postgres only (no Supabase-specific features), so pg_dump/pg_restore
-- to any provider keeps working.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aquisiteur_app') THEN
    CREATE ROLE aquisiteur_app NOLOGIN NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
-- The login role switches to aquisiteur_app with SET LOCAL ROLE per tenant transaction.
GRANT aquisiteur_app TO CURRENT_USER;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO aquisiteur_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO aquisiteur_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
--> statement-breakpoint
-- SECURITY DEFINER: reads memberships as the table owner, so policies on
-- memberships itself can call it without recursing. plpgsql because the
-- memberships table is created by the next migration.
CREATE OR REPLACE FUNCTION app.is_member(ws uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.workspace_id = ws AND m.user_id = app.current_user_id()
  );
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.has_role(ws uuid, roles text[]) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.workspace_id = ws
      AND m.user_id = app.current_user_id()
      AND m.role::text = ANY (roles)
  );
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.is_member(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.has_role(uuid, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.current_workspace_id(), app.is_member(uuid), app.has_role(uuid, text[]) TO aquisiteur_app;
