-- PostgreSQL role separation template.
-- Run with a privileged DBA account after replacing the psql variables:
--   psql "$POSTGRES_ADMIN_DATABASE_URL" \
--     -v db_name=ast_prod -v app_user=ast_app -v migration_user=ast_migration -v readonly_user=ast_readonly \
--     -f prisma/postgresql/hardening/roles.sql
--
-- Passwords are intentionally not managed here. Create users/passwords via a secret manager.

\set ON_ERROR_STOP on

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;

GRANT CONNECT ON DATABASE :"db_name" TO :app_user;
GRANT CONNECT ON DATABASE :"db_name" TO :readonly_user;
GRANT CONNECT ON DATABASE :"db_name" TO :migration_user;
GRANT USAGE ON SCHEMA public TO :app_user;
GRANT USAGE ON SCHEMA public TO :readonly_user;

GRANT SELECT, INSERT, UPDATE ON
  "Organization", "User", "Sample", "Plate", "PlateDrug", "PlateWell",
  "BreakpointSet", "BreakpointRule", "RawMic", "SirInterpretation",
  "ExportRecord", "ImageAssessment", "ImagePrediction", "ImageReview",
  "ImageWellOverride", "AuditLog", "IdempotencyRecord"
TO :app_user;

-- Avoid unnecessary destructive capabilities in the runtime role.
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM :app_user;
GRANT DELETE ON "BreakpointRule" TO :app_user;
REVOKE CREATE ON SCHEMA public FROM :app_user;

GRANT SELECT ON
  "Organization", "Sample", "Plate", "PlateDrug", "PlateWell",
  "BreakpointSet", "BreakpointRule", "RawMic", "SirInterpretation",
  "ExportRecord", "ImageAssessment", "ImagePrediction", "ImageReview",
  "ImageWellOverride", "AuditLog"
TO :readonly_user;

-- Migration role owns schema changes. It must not be used by the application runtime.
GRANT USAGE, CREATE ON SCHEMA public TO :migration_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO :migration_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO :migration_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO :migration_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO :app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO :readonly_user;
