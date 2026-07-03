# 2026-07-01 Research Local Smoke Test Evidence

> Historical evidence for the 2026-07-01 research-local release.
>
> This evidence predates `v0.2.0-research-local`. In v0.2.0, `ANONYMIZED` Excel output includes synthetic/anonymized Sample-ID, so use the 2026-07-02 evidence file for the v0.2.0 release candidate.

## Release target

| Field | Value |
| --- | --- |
| Intended use | Research / local / non-clinical only |
| Not for clinical diagnosis | PASS |
| Not for patient identifiers | PASS |
| Not for regulated/controlled production | PASS |
| Commit SHA | `be289bd569efd440e3eae39d72966f7d47bc67b9` |
| GitHub Actions run URL | Not recorded in the local workspace. Operator reported GitHub Actions success for this release target. |
| Evidence date | 2026-07-01 JST |

This evidence record does not authorize clinical, diagnostic, regulated, or controlled production use.

## CI evidence

| Check | Result | Evidence / notes |
| --- | --- | --- |
| `sqlite-unit` | PASS | Operator reported GitHub Actions success for commit `be289bd569efd440e3eae39d72966f7d47bc67b9`. Exact run URL is not recorded in this local evidence file. |
| `postgres-integration` | PASS | Operator reported GitHub Actions success for commit `be289bd569efd440e3eae39d72966f7d47bc67b9`. This is useful supporting evidence but is not required for local SQLite research use. |
| `e2e` | PASS | Operator reported GitHub Actions success for commit `be289bd569efd440e3eae39d72966f7d47bc67b9`. Exact run URL is not recorded in this local evidence file. |

## Local validation

| Check | Result | Evidence / notes |
| --- | --- | --- |
| `pnpm lint` | PASS | Completed locally on 2026-07-01 JST. |
| `pnpm test` | PASS | Completed locally on 2026-07-01 JST: 29 test files passed, 109 tests passed, PostgreSQL integration items without a local PostgreSQL URL were skipped. |
| `pnpm build` | PASS | Completed locally on 2026-07-01 JST. |
| `pnpm test:e2e` | PASS | Completed locally on 2026-07-01 JST: 4 Playwright tests passed. |

## Research-local smoke test checklist

| Smoke test item | Result | Evidence / notes |
| --- | --- | --- |
| Local app starts | PASS | Verified by Playwright E2E local web server startup. |
| Local SQLite/dev DB only | PASS | Research-local scope uses local SQLite/development settings, not production deployment. |
| Synthetic/anonymized sample only | PASS | Required by release scope. No clinical data is recorded in this evidence. |
| No patient identifiers | PASS | This evidence contains no patient names, patient IDs, direct specimen identifiers, credentials, or clinical data. |
| Sample/plate creation or lookup | PASS | Covered by `sample-to-plate` Playwright E2E. |
| 96-well input screen loads | PASS | Covered by `sample-to-plate` Playwright E2E. |
| Image review screen loads | PASS | Covered by `image-review` Playwright E2E. |
| Manual review remains required before approval | PASS | Covered by image-review component and E2E tests. |
| MIC/SIR calculation check | PASS | Covered by local unit/integration tests. |
| Excel export defaults to or uses `ANONYMIZED` | PASS | Covered by Excel privacy profile unit tests. |
| Exported Excel checked for no identifiers | PASS | For the 2026-07-01 target, automated Excel tests verified ANONYMIZED workbook excluded sample code, notes, actor, internal IDs, hidden sheets, and identifying document properties. v0.2.0 changes Sample-ID handling; use the 2026-07-02 evidence for current review. |
| Output marked/reviewed as research/non-clinical | PASS | This release target is explicitly research/local/non-clinical only. |

## GO / NO-GO decision

| Scope | Decision | Reason |
| --- | --- | --- |
| Research/local/non-clinical | GO | Local validation and smoke-test evidence passed for research/local/non-clinical use, using synthetic/anonymized/non-clinical data only. |
| Clinical/diagnostic/regulated/controlled production | NO-GO | Controlled production evidence remains separate and incomplete for clinical/regulated use. |

## Notes / limitations

- Local-only release scope.
- Non-clinical use only.
- No patient identifiers.
- No official laboratory reporting.
- Excel files must be reviewed before sharing.
- Prefer `ANONYMIZED` export for external sharing.
- Image analysis remains assistive only and requires manual review.
- Controlled production requires the separate production evidence workflow.
- This file does not contain credentials, real DB URLs, patient information, or clinical data.
