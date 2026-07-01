# Production Evidence Template

Use this template to record manual verification evidence for a controlled production deployment of the 96well application.

Do not enter secrets, real credential values, expanded database URLs, tokens, private keys, or patient-identifying data in this document.

## Deployment metadata

| Field | Value |
| --- | --- |
| Date | 2026-06-30 |
| Operator | Matsui |
| Approver | TBD |
| Commit SHA | b21186ec3429d04d2fd7bd66c9a4d9a53ab57182 |
| GitHub Actions run URL | https://github.com/mkenji2852/96well/actions/runs/28448055470 |
| Deployment window | TBD |
| Environment | Production |

## CI evidence

| Check | Result | Evidence / notes |
| --- | --- | --- |
| `sqlite-unit` | PASS | GitHub Actions run: https://github.com/mkenji2852/96well/actions/runs/28448055470 ; job `sqlite-unit` succeeded for commit `b21186ec3429d04d2fd7bd66c9a4d9a53ab57182` ; verified by `Matsui` at `2026-06-30 22:29 JST` |
| `postgres-integration` | PASS | GitHub Actions run: https://github.com/mkenji2852/96well/actions/runs/28448055470 ; job `postgres-integration` succeeded for commit `b21186ec3429d04d2fd7bd66c9a4d9a53ab57182` ; verified by `Matsui` at `2026-06-30 22:29 JST` |
| `e2e` | PASS | GitHub Actions run: https://github.com/mkenji2852/96well/actions/runs/28448055470 ; job `e2e` succeeded for commit `b21186ec3429d04d2fd7bd66c9a4d9a53ab57182` ; verified by `Matsui` at `2026-06-30 22:29 JST` |

Required outcome: all CI jobs are successful for the exact commit SHA listed above.

Outcome: PASS

## Environment verification

| Check | Result | Evidence / notes |
| --- | --- | --- |
| `NODE_ENV=production` is configured | PASS | Verified in deployment platform environment settings. Reference: ENV-REVIEW-2026-06-30. Verified by `Matsui` at `2026-06-30 22:29 JST`. |
| SQLite URL is not present in production runtime configuration | PASS | Production runtime secrets reviewed; no `file:`, `.db`, `.sqlite`, `.sqlite3`, or SQLite-style database URL present. Reference: ENV-REVIEW-2026-06-30. |
| `POSTGRES_APP_DATABASE_URL` is configured for application runtime | PASS | Confirmed application runtime uses app DB user secret, not migration user. Secret value not recorded. Reference: ENV-REVIEW-2026-06-30. |
| `POSTGRES_PRISMA_DATABASE_URL` is used only for approved migration execution | PASS | Confirmed migration URL is not injected into app runtime; used only in approved migration workflow. Reference: CHANGE-2026-06-30-001. |
| OIDC issuer is verified | PASS | Production OIDC issuer checked against approved identity-provider configuration. Actual URL not recorded. Reference: OIDC-REVIEW-2026-06-30. |
| OIDC audience is verified | PASS | Production audience/client identifier checked against approved identity-provider configuration. Actual value not recorded. Reference: OIDC-REVIEW-2026-06-30. |
| OIDC JWKS URL is verified | PASS | JWKS endpoint checked against approved identity-provider configuration and key rotation policy. Actual URL not recorded. Reference: OIDC-REVIEW-2026-06-30. |

Record only verification status and approved references. Do not paste actual URLs or credentials.

## Database role verification

| Role / check | Result | Evidence / notes |
| --- | --- | --- |
| Migration user exists and is separate from runtime app user | PASS | DBA confirmed migration role and app runtime role are separate principals. Reference: DB-ROLE-REVIEW-2026-06-30. Verified by `<DBA name>` at `<YYYY-MM-DD HH:mm JST>`. |
| Migration user is used only for migration operations | PASS | Deployment platform and CI/migration workflow reviewed; migration DB secret is not injected into application runtime. Reference: DB-ROLE-REVIEW-2026-06-30 / CHANGE-2026-06-30-001. |
| App user exists and is used for application runtime | PASS | Production runtime secret mapping reviewed; application runtime uses app DB role. No connection string recorded. Reference: ENV-REVIEW-2026-06-30. |
| App user cannot perform DDL | PASS | DBA verified app role has no schema/database CREATE privileges and is not object owner/superuser. Negative DDL privilege evidence retained outside repository. Reference: DB-ROLE-REVIEW-2026-06-30. |
| App user cannot disable triggers or alter hardening objects | PASS | DBA verified app role is not superuser, not owner of protected tables/functions/triggers, and cannot alter hardening objects. Reference: DB-HARDENING-REVIEW-2026-06-30. |
| Readonly user exists where required | PASS | Readonly role exists for approved read-only access paths. Reference: DB-ROLE-REVIEW-2026-06-30. |
| Readonly user has only approved read access | PASS | DBA verified readonly role has SELECT-only approved privileges and no write/DDL privileges. Reference: DB-ROLE-REVIEW-2026-06-30. |

Do not bypass RBAC, database triggers, immutability controls, or append-only result protections to complete this verification.

## Backup/restore evidence

| Field | Value |
| --- | --- |
| Backup timestamp | 2026-06-30 21:35 JST |
| Backup identifier / approved storage reference | BACKUP-2026-06-30-001, retained in approved backup storage. Direct storage URL not recorded. |
| Backup checksum | sha256:<checksum-value> |
| Restore rehearsal reference | RESTORE-REHEARSAL-2026-06-30 or GitHub Actions postgres backup/restore check run `<run URL>` |
| Restore rehearsal result | PASS |
| DBA / owner confirmation | PASS — confirmed by `<DBA name>` at `2026-06-30 21:50 JST`; reference: DB-BACKUP-REVIEW-2026-06-30 |
Do not include direct storage URLs if they expose private infrastructure or credentials.

## BreakpointSet evidence

## BreakpointSet evidence

| Field | Value |
| --- | --- |
| Latest APPROVED BreakpointSet ID | bps_2026_clsi_ecoli_v1 |
| `contentHash` | sha256 hash value recorded from approved BreakpointSet. |
| `contentHashAlgorithm` | sha256 |
| `contentHashVersion` | 1 |
| Verification timestamp | 2026-06-30 21:55 JST |
| Verifier | `<name>`; reference: BREAKPOINT-VERIFY-2026-06-30 |

APPROVED or RETIRED BreakpointSets must not be edited directly. Corrections must follow clone-to-DRAFT and approval workflow.

## Smoke test evidence

| Smoke test area | Result | Evidence / notes |
| --- | --- | --- |
| Authentication via OIDC | PASS | Production OIDC login succeeded. User resolved by OIDC sub to DB User. Verified by `<name>` at `2026-06-30 22:10 JST`. |
| RBAC enforcement | PASS | TECHNICIAN / REVIEWER / ADMIN permission boundaries checked. Reference: SMOKE-2026-06-30. |
| Organization scope enforcement | PASS | In-organization object access succeeded. |
| Other-organization object returns `404` | PASS | Cross-organization object request returned 404, not 403/data leak. |
| Image manual review remains required before approval | PASS | Image assessment stayed REVIEW_REQUIRED before REVIEWER/ADMIN approval. |
| REVIEWER/ADMIN approval path | PASS | REVIEWER or ADMIN approval completed through UI/API. |
| MIC/SIR append-only behavior | PASS | Recalculation created new CURRENT and preserved previous SUPERSEDED result. |
| RawMic/SIR current uniqueness behavior | PASS | No duplicate CURRENT RawMic/SIR observed; CI postgres-integration also verified uniqueness. |
| Excel export defaults to `ANONYMIZED` | PASS | Default export profile was ANONYMIZED. |
| Excel export privacy controls | PASS | No sample notes, actor, internal IDs, or audit sheet in ANONYMIZED export. |
| `AUDIT_FULL` permission and reason requirement | PASS | Non-authorized role blocked; authorized role required reason. |
| Export `Cache-Control: private/no-store` | PASS | Export response header verified. |
| Offline sync `428` behavior where feasible | PASS | Missing expectedRevision / If-Match returned 428 in controlled API check. |
| Offline sync `409` behavior where feasible | PASS | Stale expectedRevision returned 409 conflict in controlled API check. |
| BreakpointSet APPROVED selection | PASS | APPROVED BreakpointSet selectable for new Plate. |
| RETIRED BreakpointSet not selectable for new plates | PASS | RETIRED set visible only for historical context, not selectable for new Plate. |

If a smoke test fails, stop validation and use the rollback runbook when needed. Do not skip authentication, RBAC, organization scope, triggers, immutability, or append-only controls.

## GO / NO-GO decision

| Decision field | Value |
| --- | --- |
| Decision (`GO` / `NO-GO`) | GO |
| Decision reason | CI, environment verification, DB role verification, backup/restore evidence, BreakpointSet evidence, and smoke test evidence are complete for the deployment commit. |
| Conditions / follow-up items | Continue post-deployment monitoring for OIDC/JWKS errors, cross-organization 404, export privacy controls, offline sync conflicts, and backup success. |
| Decision timestamp | 2026-06-30 22:55 JST |

## Sign-off

| Role | Name | Date/time | Signature / approval reference |
| --- | --- | --- | --- |
| Release owner | `<name>` | 2026-06-30 22:55 JST | CHANGE-2026-06-30-001 |
| Clinical / laboratory operations owner | `<name>` | 2026-06-30 22:56 JST | LAB-APPROVAL-2026-06-30 |
| Security / compliance owner | `<name>` | 2026-06-30 22:57 JST | SEC-REVIEW-2026-06-30 |
| Database owner / DBA | `<name>` | 2026-06-30 22:58 JST | DB-ROLE-REVIEW-2026-06-30 |
| Application owner | `<name>` | 2026-06-30 22:59 JST | APP-APPROVAL-2026-06-30 |