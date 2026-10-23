-- Hand-written: tenant-role privileges for sent mails and invoice shares (see 0002,
-- ADR-0072). Webhook status updates and the public invoice page use the system
-- connection, scoped to the workspace in code.
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_emails, invoice_shares TO aquisiteur_app;
