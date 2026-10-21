-- Draft detection keeps only yes/no (ADR-0063): no text, no length.
-- The columns stay so the previous app version keeps working; it may write a
-- length again until it is replaced, which the new version reads as yes.
UPDATE chat_drafts
SET content = NULL,
    length = LEAST(length, 1),
    max_length = LEAST(max_length, 1)
WHERE content IS NOT NULL OR length > 1 OR max_length > 1;
--> statement-breakpoint
UPDATE workspace_settings SET chat = chat - 'storeDraftContent' WHERE chat ? 'storeDraftContent';
--> statement-breakpoint
-- draft_short / draft_long become one signal "draft" without a length.
UPDATE intent_scores i
SET signals = COALESCE((
  SELECT jsonb_agg(x.sig ORDER BY x.ord)
  FROM (
    SELECT
      CASE WHEN e->>'id' IN ('draft_short', 'draft_long')
        THEN jsonb_set(e - 'length', '{id}', '"draft"')
        ELSE e
      END AS sig,
      t.ord,
      row_number() OVER (
        PARTITION BY CASE WHEN e->>'id' IN ('draft_short', 'draft_long') THEN 'draft' ELSE t.ord::text END
        ORDER BY t.ord
      ) AS rn
    FROM jsonb_array_elements(i.signals) WITH ORDINALITY AS t(e, ord)
  ) x
  WHERE x.rn = 1
), '[]'::jsonb)
WHERE i.signals @? '$[*] ? (@.id == "draft_short" || @.id == "draft_long")';
