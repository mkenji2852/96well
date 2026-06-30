# Rollback Runbook

## Purpose

This runbook defines safe rollback and recovery guidance for the 96well antimicrobial susceptibility testing application. The goal is to restore safe service while preserving clinical data integrity, audit records, result history, export records, and BreakpointSet reproducibility.

## Rollback decision criteria

Consider rollback or containment when any of the following occur:

- Production authentication or authorization is not enforcing expected access.
- Organization scope is not enforced.
- PostgreSQL migration or hardening verification fails.
- The application cannot start with valid production PostgreSQL configuration.
- Plate save, image review approval, MIC/SIR calculation, or Excel export produces inconsistent or unverifiable records.
- Append-only RawMic/SirInterpretation history cannot be trusted.
- BreakpointSet contentHash verification fails unexpectedly.
- A deployment introduces a privacy, audit, or clinical data integrity risk.

Rollback must be explicitly approved by the incident commander, database owner/DBA, and application owner.

## Immediate containment steps

1. Pause further rollout.
2. Preserve logs, CI evidence, migration logs, and application error traces.
3. Prevent additional affected write traffic if data integrity is at risk.
4. Notify clinical/laboratory operations owner.
5. Confirm whether read-only access is safe.
6. Identify affected time window, commit SHA, database schema version, and deployment artifact.
7. Do not alter clinical result history directly.

## Application rollback procedure

1. Identify the last known-good application artifact and commit SHA.
2. Confirm the last known-good artifact is compatible with the current database schema.
3. If compatible, redeploy the last known-good artifact through the approved deployment process.
4. Keep production PostgreSQL configuration and role separation intact.
5. Run post-rollback verification checks.
6. Record rollback evidence and operator actions.

If the database schema is not compatible with the last known-good application, escalate to the database rollback policy below.

## Database rollback policy

- Prefer a forward fix where possible.
- Restore from backup only after explicit approval.
- Preserve audit records, export records, and deployment evidence.
- Do not directly mutate RawMic/SirInterpretation append-only history.
- Do not directly edit APPROVED or RETIRED BreakpointSets.
- Do not remove PostgreSQL hardening protections to make rollback easier.
- Do not use the migration user as the runtime application user.

Database restore can cause loss of post-backup writes. Before restore, define the impacted time window and clinical communication plan.

## Backup restore procedure outline

1. Confirm restore approval
   - Incident commander approval.
   - DBA approval.
   - Application owner approval.
   - Clinical/laboratory operations approval.

2. Confirm backup candidate
   - Backup identifier.
   - Backup timestamp.
   - Checksum.
   - Restore rehearsal status.
   - Expected data loss window.

3. Quiesce application writes
   - Stop affected write paths or application runtime according to the approved operations process.
   - Preserve logs and current database state if instructed by DBA.

4. Restore database
   - Restore using the approved DBA procedure.
   - Use an approved restore target.
   - Do not expose restored data outside approved environments.

5. Reapply required production hardening if needed
   - Confirm PostgreSQL migrations and hardening objects exist.
   - Confirm partial unique indexes exist.
   - Confirm immutability triggers exist.
   - Confirm database roles remain separated.

6. Restart application
   - Use production runtime configuration.
   - Confirm `NODE_ENV=production`.
   - Confirm runtime database URL uses the application user.

7. Run post-rollback verification.

## OIDC rollback checks

Verify after rollback:

- OIDC issuer is production-approved.
- OIDC audience is correct.
- JWKS URL is correct.
- Token signature verification is active.
- Database `User` mapping from OIDC `sub` still works.
- Role and organization are still loaded from database state, not OIDC claims.

## BreakpointSet rollback/retirement guidance

- Do not edit APPROVED or RETIRED BreakpointSets directly.
- If a breakpoint correction is needed, clone the affected set to a new DRAFT.
- Apply corrections to the DRAFT only.
- Validate rules and contentHash.
- Approve the corrected set through the normal ADMIN workflow.
- Retire superseded sets when appropriate.
- Preserve historical references from RawMic, SirInterpretation, Plate, and ExportRecord.

## Post-rollback verification

Verify:

- Application starts with production PostgreSQL configuration.
- Authentication succeeds for expected users.
- Unauthorized and cross-organization access remains blocked.
- Other-organization object lookup returns `404`.
- Sample and plate reads/writes work for authorized users.
- Manual image review still requires REVIEWER/ADMIN approval.
- RawMic and SirInterpretation history remains append-only and traceable.
- BreakpointSet contentHash verification passes for APPROVED sets used in current calculations.
- Excel `ANONYMIZED` export remains the default.
- `AUDIT_FULL` export remains permission-gated and reason-gated.
- Audit log actors are authenticated database User IDs.
- PostgreSQL hardening objects remain present.

## Incident record requirements

Record:

- Incident identifier.
- Start and end timestamps.
- Detection source.
- Affected commit SHA and deployment artifact.
- Database schema/migration state.
- Backup identifier used, if any.
- Restore timestamp and result, if any.
- Affected organizations, samples, plates, or exports if known.
- User-visible impact.
- Actions taken.
- Approvals.
- Evidence links.
- Follow-up corrective actions.
