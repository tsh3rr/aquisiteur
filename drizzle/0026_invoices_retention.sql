-- Hand-written: issued invoices may be deleted once the retention period of
-- § 132 BAO has passed: seven years from the end of the year of issue
-- (an invoice of 2026 from 1 January 2034). Before that, as in 0024, only a
-- workspace deletion removes them (ADR-0071).
CREATE OR REPLACE FUNCTION app.invoices_immutable() RETURNS trigger
-- SECURITY DEFINER: the workspace check must see the row whatever the policies say.
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft'
       AND (OLD.issue_date IS NULL
            OR OLD.issue_date >= make_date(extract(year FROM current_date)::int - 7, 1, 1))
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
-- The Sperrvermerk deletes a customer's score and notifications in the tenant transaction.
GRANT DELETE ON intent_scores, notifications TO aquisiteur_app;
