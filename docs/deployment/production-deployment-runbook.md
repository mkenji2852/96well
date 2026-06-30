# Production Deployment Runbook

## Purpose

This runbook describes the controlled production deployment process for the 96well antimicrobial susceptibility testing application. It is intended to protect clinical data integrity, auditability, privacy controls, and PostgreSQL production hardening during deployment.

This document is an operational guide only. It does not authorize a deployment by itself.

## Scope

In scope:

- Application deployment after successful CI.
- PostgreSQL migration and hardening verification.
- Runtime database role separation verification.
- OIDC configuration verification.
- Backup, restore readiness, and smoke checks.
- Evidence collection for release records.

Out of scope:

- Executing a production deployment from this repository document.
- Storing secrets, real production URLs, or credentials.
- Changing application security controls, migration history, or clinical data.
- Emergency clinical workflow exceptions.

## Preconditions

Before starting:

- The release readiness record is complete and reviewed.
- GitHub Actions has completed successfully for the target commit.
- The target commit SHA is approved for production.
- A maintenance window or controlled rollout window is approved.
- A tested database backup and restore plan exists.
- The deployment operator has access only to the required deployment systems.
- Production credentials are obtained from the approved secret-management system.
- No secret values are copied into tickets, chat, local files, or this repository.

## Required approvals

Deployment requires explicit approval from:

- Release owner.
- Clinical or laboratory operations owner.
- Security or compliance owner.
- Database owner/DBA.
- Application owner.

Record approver name, role, approval timestamp, and approved commit SHA in the release evidence.

## Required CI evidence

Confirm GitHub Actions for the target commit shows:

- `sqlite-unit`: success
- `postgres-integration`: success
- `e2e`: success

Record:

- CI run URL.
- Commit SHA.
- Workflow run name.
- Completion timestamp.

## Required environment variables

Confirm production configuration uses approved secret-management values for:

- `POSTGRES_PRISMA_DATABASE_URL`
- `POSTGRES_APP_DATABASE_URL`
- `POSTGRES_TEST_DATABASE_URL`
- `POSTGRES_RESTORE_TEST_DATABASE_URL`
- OIDC issuer
- OIDC audience
- JWKS URL
- `NODE_ENV=production`

Do not write real values in this document, release notes, screenshots, or logs.

## Explicit warning

- Production runtime must fail closed if a SQLite URL or missing database URL is detected.
- Never use SQLite in production.
- Never use the migration database user for application runtime.
- Do not weaken authentication, RBAC, organization scope checks, audit logging, PostgreSQL hardening, BreakpointSet immutability, or append-only result controls for deployment convenience.

## Deployment sequence

1. Confirm target commit
   - Verify the production artifact was built from the approved commit SHA.
   - Confirm CI evidence is attached to the release record.

2. Take backup before deployment
   - Create a PostgreSQL backup using the approved production backup procedure.
   - Record backup identifier, timestamp, storage location reference, and checksum.
   - Verify backup completion before continuing.

3. Confirm migration user
   - Confirm the migration user is separate from the application user.
   - Confirm the migration user has required migration privileges.
   - Confirm the migration user is not configured in application runtime.

4. Run PostgreSQL migrations
   - Use the PostgreSQL Prisma schema and PostgreSQL migration path.
   - Confirm migration logs show success.
   - Stop on any migration error.

5. Apply `roles.sql` if required
   - Apply only through the approved DBA-controlled process.
   - Do not store passwords or expanded connection strings in logs.
   - Confirm role grants match the current release expectations.

6. Verify application role privileges
   - Confirm the application user has required DML access.
   - Confirm the application user does not have schema owner or migration privileges.
   - Confirm the application user cannot perform DDL operations.

7. Verify readonly role privileges
   - Confirm readonly/audit role access is limited to approved read paths.
   - Confirm it is separate from the application and migration users.

8. Verify OIDC configuration
   - Confirm issuer, audience, and JWKS URL are production-approved.
   - Confirm token role/organization claims are not used as authority.
   - Confirm the database user mapping is active for expected users.

9. Verify latest APPROVED BreakpointSet contentHash
   - Confirm the intended latest APPROVED BreakpointSet is present.
   - Confirm `contentHash`, `contentHashAlgorithm`, and `contentHashVersion` match the release record or approved laboratory configuration.
   - Confirm RETIRED BreakpointSets remain available for historical display only.

10. Deploy application
    - Deploy the approved artifact.
    - Confirm `NODE_ENV=production`.
    - Confirm runtime uses `POSTGRES_APP_DATABASE_URL`, not the migration URL.

11. Run smoke checks
    - Execute the post-deployment checks below.
    - Stop rollout and escalate if any safety-critical check fails.

## Post-deployment checks

Verify:

- Login/authentication succeeds with production OIDC.
- Unauthenticated API access is rejected.
- RBAC grants expected access by database role.
- Organization scope is enforced.
- Other-organization object access returns `404`.
- Sample and plate access works for authorized same-organization users.
- Manual image review flow requires REVIEWER/ADMIN approval.
- Image predictions are not reflected into final PlateWell, MIC, S/I/R, or official Excel results before review approval.
- MIC/SIR recalculation preserves append-only history.
- RawMic and SirInterpretation previous results remain traceable.
- Excel export defaults to `ANONYMIZED`.
- Excel export response has `Cache-Control: private/no-store`.
- `AUDIT_FULL` export is restricted to ADMIN/AUDITOR and requires a reason.
- Audit log actor is the authenticated database User ID.

## Evidence to retain

Retain the following in the release record or approved evidence system:

- CI run URL.
- Commit SHA.
- Migration logs.
- Backup file identifier and checksum.
- Restore rehearsal result or reference.
- Smoke test result.
- Approver name and date.
- Deployment timestamp.
- Operator name.
- Any deviations and approvals.
