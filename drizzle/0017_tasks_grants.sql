-- Hand-written: tenant-role privileges for tasks (see 0002). Task reminders need
-- no notification rule (TASK_REMINDER_FALLBACK), so no backfill here; a backfill
-- could not use the new enum value inside the migration transaction anyway.
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO aquisiteur_app;
