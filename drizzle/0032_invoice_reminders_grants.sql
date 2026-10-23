-- Hand-written: tenant-role privileges for payment reminders and dunning letters (see 0002,
-- ADR-0074). The hourly job drafts and sends them inside withTenant as the workspace's owner.
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_reminders TO aquisiteur_app;
