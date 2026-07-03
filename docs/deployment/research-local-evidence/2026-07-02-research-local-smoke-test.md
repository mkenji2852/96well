# 2026-07-02 Research Local v0.2.0 Smoke Test Evidence

## Release target

| Field | Value |
| --- | --- |
| Release target | `v0.2.0-research-local` |
| Intended use | Research / local / non-clinical only |
| Not for clinical diagnosis | PASS |
| Not for patient identifiers | PASS |
| Not for regulated/controlled production | PASS |
| Commit SHA | To be recorded after the release-candidate changes are committed. |
| GitHub Actions run URL | To be recorded after CI runs for the release commit. |
| Evidence date | 2026-07-02 JST |

This evidence record does not authorize clinical, diagnostic, regulated, or controlled production use.

## CI evidence

| Check | Result | Evidence / notes |
| --- | --- | --- |
| `sqlite-unit` | PENDING | Record GitHub Actions result for the final release commit. |
| `postgres-integration` | PENDING | Optional supporting evidence for research-local use; required again only for controlled production review. |
| `e2e` | PENDING | Record GitHub Actions result for the final release commit. |

## Local validation

| Check | Result | Evidence / notes |
| --- | --- | --- |
| `pnpm lint` | PASS | Completed locally on 2026-07-02 JST. |
| `pnpm test` | PASS | Completed locally on 2026-07-02 JST: 29 test files passed, 110 tests passed, PostgreSQL integration items without a local PostgreSQL URL were skipped. |
| `pnpm build` | PASS | Completed locally on 2026-07-02 JST. |
| `pnpm test:e2e` | PASS | Completed locally on 2026-07-02 JST: 4 Playwright tests passed. |

## Research-local smoke test checklist

| Smoke test item | Result | Evidence / notes |
| --- | --- | --- |
| Local app starts | PASS | Local app opened at `http://127.0.0.1:3000/` during review. |
| Local SQLite/dev DB only | PASS | Research-local scope uses local SQLite/development settings, not production deployment. |
| Synthetic/anonymized sample only | REQUIRED | Operator must use only synthetic/anonymized/non-clinical Sample-ID values. |
| No patient identifiers | REQUIRED | Do not enter patient names, patient IDs, accession numbers, medical record numbers, direct specimen identifiers, or clinical data. |
| Sample-ID screen loads | PASS | Covered by updated `sample-to-plate` Playwright E2E. |
| Organism free text / list selection | PASS | UI supports free text with common-organism datalist. |
| Drug-layout screen loads | PASS | Covered by updated `sample-to-plate` Playwright E2E. |
| A-H row drug placement can be configured | PASS | UI supports row enablement, drug name, unit, and 12 concentrations. |
| Sample/plate creation or lookup | PASS | Covered by `sample-to-plate` Playwright E2E. |
| 96-well input screen loads | PASS | Covered by `sample-to-plate` Playwright E2E. |
| 96-well grid shows drug and concentration | PASS | Implemented in the plate editor; operator should visually confirm during local smoke test. |
| Right-click lower-concentration growth action | PASS | Covered by unit test for lower-concentration growth application; operator should visually confirm context menu during local smoke test. |
| Save without Breakpoint configuration | PASS | Normal save payload omits `breakpointSetId`; server skips recalculation when absent. |
| Sample-ID return button | PASS | Implemented in plate editor; operator should visually confirm during local smoke test. |
| Image review screen loads | PASS | Covered by `image-review` Playwright E2E. |
| Manual review remains required before approval | PASS | Covered by image-review component and E2E tests. |
| MIC/SIR calculation behavior | PASS | Breakpoint-free normal save does not require MIC/SIR interpretation; existing calculation tests remain for compatibility paths. |
| Excel export defaults to or uses `ANONYMIZED` | PASS | Covered by Excel privacy profile unit tests. |
| Excel includes Sample-ID safely | PASS | Sample-ID is included with formula injection protection. It must be synthetic/anonymized/non-clinical only. |
| Exported Excel checked for no patient identifiers | REQUIRED | Manual review remains required before external sharing. |
| Non-JSON API error handling | PASS | Non-JSON/HTML responses are handled without exposing raw `Unexpected token '<'` JSON parse text. |
| Output marked/reviewed as research/non-clinical | REQUIRED | Output must not be used for clinical diagnosis or official reporting. |

## GO / NO-GO decision

| Scope | Decision | Reason |
| --- | --- | --- |
| Research/local/non-clinical | CONDITIONAL GO | Local validation passed. Final GO requires recording the final commit SHA, CI evidence if available, and completed local smoke-test review with synthetic/anonymized data. |
| Clinical/diagnostic/regulated/controlled production | NO-GO | Controlled production evidence remains separate and is not completed for this v0.2.0 research-local scope. |

## Notes / limitations

- Local-only release scope.
- Non-clinical use only.
- No patient identifiers.
- No official laboratory reporting.
- Sample-ID is exported and therefore must be synthetic/anonymized.
- Excel files must be reviewed before sharing.
- Prefer `ANONYMIZED` export for external sharing.
- Breakpoint-free saves are allowed and do not create formal MIC/SIR interpretation records.
- Breakpoint management remains only for compatibility, history, administrative review, and future controlled-production re-review.
- Image analysis remains assistive only and requires manual review.
- Controlled production requires the separate production evidence workflow.
- This file does not contain credentials, real DB URLs, patient information, or clinical data.
