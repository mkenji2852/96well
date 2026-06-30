# Production Evidence Template

Use this template to record manual verification evidence for a controlled production deployment of the 96well application.

Do not enter secrets, real credential values, expanded database URLs, tokens, private keys, or patient-identifying data in this document.

## Deployment metadata

| Field | Value |
| --- | --- |
| Date |  |
| Operator |  |
| Approver |  |
| Commit SHA |  |
| GitHub Actions run URL |  |
| Deployment window |  |
| Environment | Production |

## CI evidence

| Check | Result | Evidence / notes |
| --- | --- | --- |
| `sqlite-unit` |  |  |
| `postgres-integration` |  |  |
| `e2e` |  |  |

Required outcome: all CI jobs are successful for the exact commit SHA listed above.

## Environment verification

| Check | Result | Evidence / notes |
| --- | --- | --- |
| `NODE_ENV=production` is configured |  |  |
| SQLite URL is not present in production runtime configuration |  |  |
| `POSTGRES_APP_DATABASE_URL` is configured for application runtime |  |  |
| `POSTGRES_PRISMA_DATABASE_URL` is used only for approved migration execution |  |  |
| OIDC issuer is verified |  |  |
| OIDC audience is verified |  |  |
| OIDC JWKS URL is verified |  |  |

Record only verification status and approved references. Do not paste actual URLs or credentials.

## Database role verification

| Role / check | Result | Evidence / notes |
| --- | --- | --- |
| Migration user exists and is separate from runtime app user |  |  |
| Migration user is used only for migration operations |  |  |
| App user exists and is used for application runtime |  |  |
| App user cannot perform DDL |  |  |
| App user cannot disable triggers or alter hardening objects |  |  |
| Readonly user exists where required |  |  |
| Readonly user has only approved read access |  |  |

Do not bypass RBAC, database triggers, immutability controls, or append-only result protections to complete this verification.

## Backup/restore evidence

| Field | Value |
| --- | --- |
| Backup timestamp |  |
| Backup identifier / approved storage reference |  |
| Backup checksum |  |
| Restore rehearsal reference |  |
| Restore rehearsal result |  |
| DBA / owner confirmation |  |

Do not include direct storage URLs if they expose private infrastructure or credentials.

## BreakpointSet evidence

| Field | Value |
| --- | --- |
| Latest APPROVED BreakpointSet ID |  |
| `contentHash` |  |
| `contentHashAlgorithm` |  |
| `contentHashVersion` |  |
| Verification timestamp |  |
| Verifier |  |

APPROVED or RETIRED BreakpointSets must not be edited directly. Corrections must follow clone-to-DRAFT and approval workflow.

## Smoke test evidence

| Smoke test area | Result | Evidence / notes |
| --- | --- | --- |
| Authentication via OIDC |  |  |
| RBAC enforcement |  |  |
| Organization scope enforcement |  |  |
| Other-organization object returns `404` |  |  |
| Image manual review remains required before approval |  |  |
| REVIEWER/ADMIN approval path |  |  |
| MIC/SIR append-only behavior |  |  |
| RawMic/SIR current uniqueness behavior |  |  |
| Excel export defaults to `ANONYMIZED` |  |  |
| Excel export privacy controls |  |  |
| `AUDIT_FULL` permission and reason requirement |  |  |
| Export `Cache-Control: private/no-store` |  |  |
| Offline sync `428` behavior where feasible |  |  |
| Offline sync `409` behavior where feasible |  |  |
| BreakpointSet APPROVED selection |  |  |
| RETIRED BreakpointSet not selectable for new plates |  |  |

If a smoke test fails, stop validation and use the rollback runbook when needed. Do not skip authentication, RBAC, organization scope, triggers, immutability, or append-only controls.

## GO / NO-GO decision

| Decision field | Value |
| --- | --- |
| Decision (`GO` / `NO-GO`) |  |
| Decision reason |  |
| Conditions / follow-up items |  |
| Decision timestamp |  |

## Sign-off

| Role | Name | Date/time | Signature / approval reference |
| --- | --- | --- | --- |
| Release owner |  |  |  |
| Clinical / laboratory operations owner |  |  |  |
| Security / compliance owner |  |  |  |
| Database owner / DBA |  |  |  |
| Application owner |  |  |  |
