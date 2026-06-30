# Production Environment Variables

## Purpose

This document defines the environment-variable policy for controlled production deployment of the 96well antimicrobial susceptibility testing application. It explains required variables, non-production variables, forbidden production values, database role separation, and secret-handling rules.

Do not store real credentials, real production URLs, or secret values in this repository.

## Production environment variable policy

- Production runtime must use approved secret-management facilities.
- Production runtime must fail closed if required database configuration is missing.
- Production runtime must never use SQLite.
- Migration credentials must not be provided to the running application.
- OIDC configuration must point to the approved production identity provider.
- Variables must be reviewed before deployment and after any incident response.

## Required variables

Production runtime requires:

- `NODE_ENV=production`
- `POSTGRES_APP_DATABASE_URL`
- OIDC issuer
- OIDC audience
- JWKS URL

Migration execution requires:

- `POSTGRES_PRISMA_DATABASE_URL`

The migration URL is for migration execution only. The application runtime must use `POSTGRES_APP_DATABASE_URL`.

## Non-production / CI variables

The following variables are intended for CI, test, or rehearsal use and must not be used as production runtime database configuration:

- `POSTGRES_TEST_DATABASE_URL`
- `POSTGRES_RESTORE_TEST_DATABASE_URL`

These are used for PostgreSQL integration testing and backup/restore rehearsal paths.

## Forbidden production values

Production must not use:

- SQLite URLs.
- Missing database URL.
- Migration user credentials as application runtime credentials.
- Test OIDC issuer.
- Test OIDC audience.
- Development-only authentication settings.
- Any credential copied into source control, documentation, screenshots, or chat.

If any forbidden value is detected, stop deployment validation and correct the configuration through the approved secret-management process.

## Role separation explanation

### Migration user

The migration user is used only for schema migration and approved database hardening operations. It may require privileges to create or alter schema objects, indexes, triggers, and functions. It must not be configured for application runtime.

### App user

The app user is used by the running application. It should have only the minimum data access required for application workflows. It must not have privileges to perform schema migrations, disable triggers, drop tables, truncate tables, or alter hardening objects.

### Readonly user

The readonly user is used for approved read-only or audit/reporting access where needed. It must be separate from the migration and app users and should have only approved read access.

## Secret handling rules

- Never commit real credentials.
- Never commit real production URLs containing usernames, passwords, hosts, or database names.
- Use the deployment platform secret manager.
- Limit secret visibility to authorized operators.
- Rotate credentials after a suspected incident or exposure.
- Rotate credentials when an operator with access leaves the authorized group.
- Do not paste secrets into issue trackers, CI logs, screenshots, or runbooks.
- Validate that CI logs and deployment logs do not print expanded connection strings.

## Verification checklist

Before production deployment, verify:

- [ ] `NODE_ENV=production` is set.
- [ ] `POSTGRES_APP_DATABASE_URL` is present in the production secret manager.
- [ ] `POSTGRES_APP_DATABASE_URL` uses the app user.
- [ ] `POSTGRES_PRISMA_DATABASE_URL` is present only for migration execution.
- [ ] `POSTGRES_PRISMA_DATABASE_URL` uses the migration user.
- [ ] The running application does not receive migration user credentials.
- [ ] No production runtime variable contains a SQLite URL.
- [ ] OIDC issuer is the approved production issuer.
- [ ] OIDC audience is the approved production audience.
- [ ] JWKS URL is the approved production JWKS endpoint.
- [ ] Test PostgreSQL URLs are not used for production runtime.
- [ ] Restore-test URLs are not used for production runtime.
- [ ] Secrets are stored only in the approved secret manager.
- [ ] Database role separation has been verified by DBA or owner.
