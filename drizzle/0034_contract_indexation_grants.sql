-- Hand-written: tenant-role privileges for index adjustments and time entries of maintenance
-- contracts (see 0002, ADR-0075). The hourly job writes them inside withTenant as the owner.
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_adjustments TO aquisiteur_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_time_entries TO aquisiteur_app;
