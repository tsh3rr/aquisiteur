-- Hand-written: tenant-role privileges for projects and offers (see 0002), and a
-- project „Erstakquise“ for every prospect that already has an exposé (§7.10),
-- so no exposé is left without a project. Offer notifications need no rule
-- (fallback channels, like task reminders), so there is no rule backfill.
GRANT SELECT, INSERT, UPDATE, DELETE ON projects, catalog_items, offers, offer_versions, number_series TO aquisiteur_app;
--> statement-breakpoint
INSERT INTO projects (workspace_id, prospect_id, name, status)
SELECT e.workspace_id, e.prospect_id, 'Erstakquise', 'idea'
FROM exposes e
WHERE e.project_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.workspace_id = e.workspace_id AND p.prospect_id = e.prospect_id
  );
--> statement-breakpoint
UPDATE exposes e
SET project_id = (
  SELECT p.id FROM projects p
  WHERE p.workspace_id = e.workspace_id AND p.prospect_id = e.prospect_id
  ORDER BY p.created_at
  LIMIT 1
)
WHERE e.project_id IS NULL;
