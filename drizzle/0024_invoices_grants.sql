-- Hand-written: tenant-role privileges for invoices and payments (see 0002), and a
-- guard that keeps issued invoices unchanged (§ 11 UStG, § 132 BAO, ADR-0070).
-- An issued invoice may only move to „cancelled“; it cannot be deleted, except
-- when its whole workspace is deleted (the cascade from workspaces).
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices, invoice_payments TO aquisiteur_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.invoices_immutable() RETURNS trigger
-- SECURITY DEFINER: the workspace check must see the row whatever the policies say.
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft'
       AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN
      RAISE EXCEPTION 'issued invoice % cannot be deleted', OLD.number USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'issued' AND NEW.status = 'cancelled'
     AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'issued invoice % cannot be changed', OLD.number USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_immutable
BEFORE UPDATE OR DELETE ON invoices
FOR EACH ROW EXECUTE FUNCTION app.invoices_immutable();
