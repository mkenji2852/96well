# Production Smoke Test

## Purpose

This document defines the smoke test procedure for a controlled production deployment of the 96well antimicrobial susceptibility testing application. The smoke test confirms that critical authentication, authorization, clinical data integrity, privacy, audit, offline-conflict, BreakpointSet, and export controls are functioning after deployment.

This procedure does not authorize bypassing safety controls and does not include production credentials or real environment URLs.

## Scope

In scope:

- Post-deployment validation of the deployed production application.
- Verification of core clinical workflows without weakening security controls.
- Evidence collection for release and operational records.

Out of scope:

- Production deployment execution.
- Database migrations.
- Direct database writes.
- Credential disclosure.
- Disabling authentication, RBAC, PostgreSQL triggers, BreakpointSet immutability, or append-only result protections.

## Preconditions

Before smoke testing starts:

- Deployment has completed using the approved production artifact.
- `NODE_ENV=production` is active.
- Runtime is configured to use the application database user.
- Migration user is not configured for application runtime.
- Smoke test users and test data are approved for production validation.
- Operators understand the rollback runbook and escalation path.

## Required evidence before smoke test

Confirm and retain evidence that:

- CI completed successfully for the deployed commit.
- Database backup completed before deployment.
- PostgreSQL migrations completed successfully.
- Database roles were verified.
- OIDC configuration was verified.

Do not proceed if any required evidence is missing or ambiguous.

## Smoke test sequence

1. Application health check
   - Open the production application through the approved entry point.
   - Confirm the application responds without exposing stack traces or internal configuration.

2. Login via OIDC
   - Sign in with an approved smoke-test account.
   - Confirm the OIDC flow completes successfully.

3. Authenticated user resolves from DB User by OIDC sub
   - Confirm the authenticated session maps to the expected database `User`.
   - Confirm displayed or API-visible user details match the database user, not arbitrary token role or organization claims.

4. Role/organization claim from token is not trusted
   - Confirm authorization follows the database user role and organization.
   - Do not rely on token-supplied role or organization claims for access decisions.

5. Organization-scoped object access
   - Access an approved same-organization sample or plate.
   - Confirm authorized access succeeds.

6. Other-organization object returns 404
   - Attempt access to an approved cross-organization test object, if available.
   - Confirm the response is `404` rather than exposing object existence or authorization details.

7. Sample creation or lookup
   - Create or look up an approved smoke-test sample.
   - Confirm audit and organization scope are correct.

8. Plate creation or lookup
   - Create or look up an approved smoke-test plate.
   - Confirm plate organization, sample linkage, and revision state are correct.

9. Image assessment upload/review screen loads
   - Open the image review workflow for an approved smoke-test plate or assessment.
   - Confirm image assessment data loads without exposing unauthorized records.

10. Manual review remains REVIEW_REQUIRED before approval
    - Confirm image-assisted data remains review-required before REVIEWER/ADMIN approval.
    - Confirm predictions are not treated as final results before approval.

11. REVIEWER/ADMIN approval path
    - Using an approved reviewer/admin smoke-test account, complete the review path on test data.
    - Confirm override reasons are required where applicable.

12. MIC/SIR append-only result creation
    - Trigger or verify an approved calculation path on smoke-test data.
    - Confirm RawMic and SirInterpretation results are created without deleting previous history.

13. RawMic/SIR CURRENT uniqueness behavior
    - Confirm current results are unique for the expected plate/drug scope.
    - Confirm superseded results remain retained and traceable.

14. Excel export ANONYMIZED default
    - Request an export without specifying a profile.
    - Confirm `ANONYMIZED` is used by default.
    - Confirm direct identifiers, notes, actor names, and raw audit JSON are not included.

15. CLINICAL_INTERNAL notes confirmation
    - Confirm notes are excluded by default.
    - Confirm notes require explicit permission and acknowledgement if included.

16. AUDIT_FULL permission/reason requirement
    - Confirm users without audit permission cannot create `AUDIT_FULL` exports.
    - Confirm permitted ADMIN/AUDITOR users must provide a reason.

17. Cache-Control private/no-store
    - Confirm Excel export response includes private/no-store cache control.

18. Offline sync 428/409 behavior where feasible
    - Verify missing revision precondition returns `428` in an approved non-destructive smoke path.
    - Verify stale revision returns `409` where feasible.
    - Do not force unsafe production data conflicts.

19. BreakpointSet APPROVED selection
    - Confirm approved BreakpointSets are selectable for new calculations.
    - Confirm the selected set shows expected standard, version, and effective metadata.

20. RETIRED BreakpointSet not selectable for new plates
    - Confirm RETIRED BreakpointSets are not offered for new plate calculations.
    - Confirm historical plates can still display referenced RETIRED set information.

## Expected results

Expected smoke test outcome:

- Authentication succeeds only through approved OIDC.
- Authorization is based on database User role and organization.
- Cross-organization access returns `404`.
- Image analysis remains assistive only until manual review approval.
- MIC/SIR records remain append-only and traceable.
- Excel export defaults to `ANONYMIZED`.
- Sensitive export profiles remain permission-gated.
- Offline conflict protections return expected `428`/`409` responses where tested.
- BreakpointSet lifecycle and contentHash controls remain enforced.
- Audit evidence identifies the authenticated database User.

## Evidence to retain

Retain:

- Smoke test date/time.
- Operator name.
- Deployed commit SHA.
- CI run URL.
- Backup identifier.
- Smoke-test account identifiers or approved aliases.
- Smoke-test sample/plate identifiers or approved aliases.
- Export response evidence without sensitive content.
- Pass/fail result for each smoke step.
- Any incident or deviation record.

## Failure handling

If any smoke test step fails:

1. Stop deployment validation.
2. Do not bypass authentication, RBAC, organization scope, PostgreSQL triggers, BreakpointSet immutability, or append-only history protections.
3. Record the failure as an incident or deployment validation failure.
4. Preserve logs and evidence.
5. Notify release owner, security/compliance owner, DBA, and clinical/laboratory operations owner.
6. Use the rollback runbook if rollback or containment is needed.
