# Pre-production Checklist

Use this checklist immediately before controlled production deployment. Do not proceed while any required item is unchecked or unknown.

## CI evidence

- [ ] Target commit SHA is recorded.
- [ ] GitHub Actions run URL is recorded.
- [ ] `sqlite-unit` job is success.
- [ ] `postgres-integration` job is success.
- [ ] `e2e` job is success.
- [ ] Release readiness document is reviewed.

## Environment variables

- [ ] `NODE_ENV=production` is configured.
- [ ] `POSTGRES_PRISMA_DATABASE_URL` is configured through secret management.
- [ ] `POSTGRES_APP_DATABASE_URL` is configured through secret management.
- [ ] `POSTGRES_TEST_DATABASE_URL` is not used for application runtime.
- [ ] `POSTGRES_RESTORE_TEST_DATABASE_URL` is not used for application runtime.
- [ ] No production runtime database variable points to SQLite.
- [ ] No real credentials are stored in repository files.
- [ ] Migration user URL is not supplied to application runtime.

## Database roles

- [ ] Migration user is separate from application user.
- [ ] Application user is separate from readonly/audit user.
- [ ] Migration user has required migration privileges.
- [ ] Application user has required runtime DML privileges.
- [ ] Application user cannot perform DDL.
- [ ] Application user cannot drop or truncate application tables.
- [ ] Application user cannot alter PostgreSQL hardening objects.
- [ ] Readonly/audit user has only approved read access.

## PostgreSQL hardening

- [ ] PostgreSQL version is approved for production.
- [ ] PostgreSQL Prisma schema path is used for production migrations.
- [ ] PostgreSQL migrations are present and reviewed.
- [ ] Hardening migration is present and reviewed.
- [ ] RawMic `CURRENT` partial unique index exists.
- [ ] SirInterpretation `CURRENT` partial unique index exists.
- [ ] BreakpointSet formal version partial unique index exists.
- [ ] BreakpointSet immutability trigger exists.
- [ ] BreakpointRule immutability trigger exists.
- [ ] Schema drift check result is retained.

## Backup/restore

- [ ] Pre-deployment backup is scheduled.
- [ ] Backup storage destination is approved.
- [ ] Backup checksum procedure is defined.
- [ ] Restore rehearsal result is available.
- [ ] Expected restore time objective is understood.
- [ ] Expected data-loss window for restore is understood.
- [ ] Rollback runbook is reviewed by operators.

## OIDC

- [ ] Production OIDC issuer is approved.
- [ ] Production OIDC audience is approved.
- [ ] JWKS URL is approved.
- [ ] JWKS key rotation behavior is understood.
- [ ] Database `User.externalSubject` mapping is ready.
- [ ] Role and organization are loaded from database state.
- [ ] OIDC role/organization claims are not used as authorization authority.

## RBAC / organization scope

- [ ] RBAC permission matrix is reviewed.
- [ ] TECHNICIAN access is limited as expected.
- [ ] REVIEWER access is limited as expected.
- [ ] ADMIN access is limited as expected.
- [ ] AUDITOR/export access is limited as expected.
- [ ] Cross-organization sample access returns `404`.
- [ ] Cross-organization plate access returns `404`.
- [ ] Audit actor is authenticated database User ID.

## Manual image review

- [ ] Image assessment starts as review-required.
- [ ] Confidence does not bypass review.
- [ ] TECHNICIAN cannot approve image review.
- [ ] REVIEWER/ADMIN approval is required before final results.
- [ ] ImagePrediction and ImageReview remain separate.
- [ ] Override reason is required.
- [ ] Override before/after state and modelVersion are retained.

## RawMic/SIR append-only

- [ ] RawMic records are not physically deleted during recalculation.
- [ ] SirInterpretation records are not physically deleted during recalculation.
- [ ] Recalculation supersedes previous CURRENT records.
- [ ] Previous SUPERSEDED history remains queryable.
- [ ] `breakpointSetId` is stored on results.
- [ ] Engine versions are stored on results.
- [ ] `sourceWellRevision` is stored on RawMic.
- [ ] Current-result uniqueness is protected by PostgreSQL partial unique indexes.

## Excel export privacy controls

- [ ] `ANONYMIZED` is the default profile.
- [ ] `ANONYMIZED` output behavior is reviewed against the target release. For `v0.2.0-research-local`, Sample-ID is included and must be synthetic/anonymized; controlled production remains NO-GO until this is re-reviewed for production privacy requirements.
- [ ] `CLINICAL_INTERNAL` notes require permission and explicit acknowledgement.
- [ ] `AUDIT_FULL` requires ADMIN/AUDITOR-equivalent permission.
- [ ] `AUDIT_FULL` requires an export reason.
- [ ] Formula injection sanitization is active.
- [ ] Export snapshot includes result IDs and revisions.
- [ ] `Cache-Control: private/no-store` is present for file delivery.

## Offline sync conflict controls

- [ ] Plate save requires expected revision or `If-Match`.
- [ ] Missing precondition returns `428`.
- [ ] Revision conflict returns `409`.
- [ ] Idempotency key is required/handled for write retries.
- [ ] Same idempotency key and same body is applied once.
- [ ] Same idempotency key and different body conflicts.
- [ ] Legacy IndexedDB formats are not automatically submitted.

## BreakpointSet lifecycle/contentHash

- [ ] DRAFT can be edited only through authorized ADMIN flow.
- [ ] APPROVED set is immutable.
- [ ] RETIRED set is immutable.
- [ ] Corrections are made by clone-to-DRAFT.
- [ ] Latest APPROVED BreakpointSet is identified.
- [ ] Latest APPROVED BreakpointSet `contentHash` is confirmed.
- [ ] `contentHashAlgorithm` is `sha256`.
- [ ] `contentHashVersion` is approved.
- [ ] RETIRED sets are not selectable for new calculations.
- [ ] RETIRED sets remain visible for historical plates.

## Final GO / NO-GO decision

- [ ] GO
- [ ] NO-GO

Decision notes:

```text
Decision:
Reason:
Approver:
Date/time:
Commit SHA:
CI run URL:
```
