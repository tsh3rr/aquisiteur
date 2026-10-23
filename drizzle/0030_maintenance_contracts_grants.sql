-- Hand-written: tenant-role privileges for maintenance contracts (see 0002, ADR-0073).
-- The hourly job bills them inside withTenant as the workspace's owner.
GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_contracts TO aquisiteur_app;
