# 2026-06-30 Release Readiness

> Historical controlled-production readiness record.
>
> This record predates the `v0.2.0-research-local` scope change. It does not authorize the current research-local release for clinical, diagnostic, regulated, or controlled production use. In `v0.2.0-research-local`, `ANONYMIZED` Excel output includes synthetic/anonymized Sample-ID, so controlled production privacy requirements must be re-reviewed before any future production GO decision.

## Release summary

This release prepares the 96-well antimicrobial susceptibility testing application for a controlled production deployment. The release focuses on clinical data integrity, authentication and authorization enforcement, image-assisted manual review safety, append-only MIC/S/I/R result history, privacy-aware Excel export, BreakpointSet lifecycle control, offline conflict handling, and PostgreSQL production hardening.

No new clinical feature scope is introduced by this release-readiness record. This document records the verified controls and the remaining manual deployment checks required before production cutover.

## Scope of this release

- 96-well plate data entry and review workflow.
- OIDC-authenticated API access with RBAC and organization scope.
- Image analysis as assistive-only input with mandatory manual review.
- RawMic and SirInterpretation append-only result history.
- Offline input conflict protection and idempotency.
- Purpose-specific Excel export profiles and snapshot integrity.
- BreakpointSet DRAFT / APPROVED / RETIRED lifecycle and immutability.
- PostgreSQL production migration, hardening, trigger, index, baseline, role separation, and backup/restore verification path.

Out of scope for this release-readiness change:

- New application features.
- Large UI redesign.
- Relaxing existing security, audit, or clinical data-integrity requirements.
- Changing production business rules outside the verified release scope.

## CI evidence

- GitHub Actions run name: `Strip Prisma schema parameter for pg dump #11`
- Commit: `8a6524a`
- Full commit observed locally: `8a6524afd3f86af3150131cf57284ec345a6368a`
- Branch checked locally: `main`
- `origin/main` checked locally: `8a6524afd3f86af3150131cf57284ec345a6368a`

CI jobs reported by GitHub Actions:

- `sqlite-unit`: success
- `postgres-integration`: success
- `e2e`: success

The PostgreSQL job success is important because local development can run SQLite-focused tests quickly, but production safety depends on PostgreSQL-specific migrations, partial unique indexes, triggers, role separation, and backup/restore rehearsal.

## Security controls verified

- OIDC Bearer token validation is performed with JWKS signature verification.
- The application maps the OIDC `sub` to a database `User`.
- Role and organization values from OIDC claims are not trusted for authorization decisions.
- User role and organization are resolved from database state.
- RBAC is enforced by route handlers.
- Organization scope is enforced for scoped resources.
- Other-organization objects are returned as `404 NOT_FOUND` rather than exposed as authorization details.
- Audit actors are fixed to the authenticated database User ID, not client-supplied headers or display names.

## Image manual review controls verified

- Image assessments start as review-required regardless of confidence.
- `manualReviewRequired` remains true until a qualified review decision is made.
- `REVIEW_REQUIRED` state is required before reviewer/admin approval.
- Image predictions do not update final `PlateWell`, MIC, S/I/R, or official Excel results before REVIEWER/ADMIN approval.
- `ImagePrediction` and `ImageReview` are separated as source prediction data and human review decision data.
- Override data records reason, before state, after state, reviewer, timestamp, source prediction, and `modelVersion`.
- TECHNICIAN users can upload/request review but cannot perform final approval.

## RawMic/SIR append-only controls verified

- RawMic and SirInterpretation records are append-only.
- Previous `CURRENT` records are changed to `SUPERSEDED` and retained.
- New recalculations create new `CURRENT` records.
- PostgreSQL hardening includes partial unique indexes to prevent duplicate `CURRENT` records per plate/drug scope.
- `breakpointSetId` is stored with each result.
- Calculation engine version and rule engine version are stored.
- `sourceWellRevision` is stored for RawMic.
- Excel export metadata records the RawMic and SirInterpretation IDs used for the exported snapshot.
- Historical RawMic/SIR chains can be traced through supersession metadata.

## Offline sync controls verified

- Plate updates require `expectedRevision` or `If-Match`.
- Missing revision precondition returns `428 PRECONDITION_REQUIRED`.
- Stale revision returns `409 REVISION_CONFLICT`.
- Idempotency key handling prevents duplicate application of the same request.
- Same idempotency key with a different request body returns conflict.
- IndexedDB draft state and sync queue are isolated client-side.
- Legacy IndexedDB draft formats are not automatically submitted without safe migration/validation.
- Server-side revision and idempotency checks remain authoritative even if Web Locks or client coordination are unavailable.

## Excel export controls verified

- Default export profile is `ANONYMIZED`.
- For the 2026-06-30 controlled-production candidate, `ANONYMIZED` was expected to exclude sample code, notes, actor identity, internal IDs, and raw audit JSON. This expectation must be re-reviewed before any future controlled-production GO decision because `v0.2.0-research-local` includes synthetic/anonymized Sample-ID.
- `CLINICAL_INTERNAL` can include facility-internal clinical identifiers only within permission and profile policy.
- `CLINICAL_INTERNAL` notes require explicit authorization and warning/acknowledgement.
- `AUDIT_FULL` is limited to ADMIN/AUDITOR-equivalent permission and requires an export reason.
- User-input strings are sanitized against Excel formula injection.
- Export generation uses a fixed snapshot of plate revision, well revision, result revision, breakpoint set, RawMic IDs, SirInterpretation IDs, and review IDs.
- `Cache-Control` is set to private/no-store for delivered files.
- Export records include metadata sufficient to identify which result versions were exported.

## BreakpointSet controls verified

- Formal lifecycle is `DRAFT -> APPROVED -> RETIRED`.
- APPROVED and RETIRED BreakpointSets are immutable.
- APPROVED and RETIRED BreakpointRules cannot be inserted, updated, or deleted.
- Changes require cloning into an independent DRAFT.
- Clone-created DRAFT sets are editable without mutating the original set.
- `contentHash`, `contentHashAlgorithm`, and `contentHashVersion` are stored.
- MIC/SIR calculation and official Excel export re-verify `contentHash`.
- RETIRED BreakpointSets are not offered for new selection.
- Historical plates can still display and reproduce results that reference a RETIRED BreakpointSet.

## PostgreSQL production controls verified

- SQLite is retained only for fast local/unit testing.
- Production runtime fails closed when PostgreSQL runtime URL is missing or a SQLite URL is supplied.
- PostgreSQL-specific Prisma schema exists under `prisma/postgresql/schema.prisma`.
- PostgreSQL migration path exists under `prisma/postgresql/migrations`.
- Hardening migration exists for PostgreSQL-only controls.
- Partial unique indexes are defined for RawMic and SirInterpretation `CURRENT` result uniqueness.
- BreakpointSet and BreakpointRule immutability triggers are defined.
- `roles.sql` documents migration user, application user, and read-only/audit user separation.
- Application user is intended to be denied DDL, trigger disabling, DROP, TRUNCATE, and migration privileges.
- Backup/restore check is part of the PostgreSQL CI path.
- Existing-DB baseline rehearsal is part of the PostgreSQL CI path and must not proceed without explicit backup and baseline approval flags.

## Remaining manual deployment checks

Before production cutover, confirm:

- Production environment variables do not include SQLite URLs.
- `POSTGRES_PRISMA_DATABASE_URL`, `POSTGRES_APP_DATABASE_URL`, and read-only/audit database users are separated.
- Migration user has migration privileges only and is not supplied to the running application.
- Application user cannot execute DDL, disable triggers, drop tables, truncate tables, or run migrations.
- OIDC issuer, audience, and JWKS URL match the production identity provider configuration.
- OIDC signing key rotation behavior is understood and monitored.
- A production backup is taken before migration.
- Restore procedure has been rehearsed from that backup or from an anonymized production-equivalent backup.
- Latest APPROVED BreakpointSet has the expected `contentHash`, `contentHashAlgorithm`, and `contentHashVersion`.
- PostgreSQL server logs or DB audit tooling can detect direct DB changes rejected by triggers.
- Release operators know how to stop the application and restore the database if migration or hardening validation fails.

## Release decision

GO for controlled production deployment.

This GO is conditional on completing the manual deployment checks above, especially production environment variable review, database role separation review, OIDC configuration review, backup creation, restore rehearsal confirmation, and latest APPROVED BreakpointSet contentHash confirmation.
