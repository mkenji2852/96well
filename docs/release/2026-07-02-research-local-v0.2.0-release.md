# 2026-07-02 Research Local v0.2.0 Release Candidate

## Release summary

This record covers the `v0.2.0-research-local` release candidate for research-only, local, non-clinical use of the 96well application.

This release candidate is intended for synthetic, anonymized, or otherwise non-clinical data only. It is not approved for clinical diagnosis, patient care, official laboratory reporting, regulated operation, or controlled production deployment.

## Release decision

| Scope | Decision |
| --- | --- |
| Research / local / non-clinical | CONDITIONAL GO |
| Clinical / diagnostic / regulated / controlled production | NO-GO |

The research-local decision is conditional on completing the local smoke test with synthetic/anonymized data and recording the release commit SHA and evidence. Controlled production remains NO-GO unless the separate production evidence workflow is completed.

## Scope of this release candidate

- Rebuilt initial workflow:
  - Sample-ID entry;
  - organism entry by free text or common-organism list;
  - plate selection;
  - existing Sample/Plate opening path.
- Added a drug-layout step before plate entry:
  - A-H row selection;
  - drug name per enabled row;
  - unit per enabled row;
  - 12 concentrations per enabled row.
- Expanded 96-well entry:
  - drug name and concentration are visible in each configured well;
  - return button goes back to the Sample-ID screen;
  - right-click well menu can mark lower concentrations in the same row as growth.
- Removed Breakpoint selection from the normal plate entry/save flow:
  - a plate can be saved without Breakpoint configuration;
  - the client does not send `breakpointSetId` during normal plate save;
  - when `breakpointSetId` is absent, MIC/SIR recalculation is skipped.
- Kept Breakpoint management APIs and historical compatibility code for existing history, administrative review, and future controlled workflows.
- Updated Excel export:
  - Sample-ID is included;
  - Sample-ID must be synthetic/anonymized and non-clinical;
  - formula injection protections still apply.
- Improved non-JSON API error handling so HTML error pages do not surface as `Unexpected token '<'`.

## Intended use

- Research-only local evaluation.
- Local SQLite/development setup.
- Synthetic, anonymized, or otherwise non-clinical samples.
- Non-clinical Excel sharing after manual review of the workbook.

## Not intended use

- Clinical diagnosis.
- Patient care or treatment decisions.
- Official laboratory reports.
- Patient-identifying data entry.
- Regulated operation.
- Controlled production deployment.

## Sample-ID policy

Sample-ID in this release means a research-local sample identifier only.

Allowed examples:

- synthetic local IDs;
- randomized research IDs;
- anonymized IDs that do not directly identify a person, patient, specimen, accession, or medical record.

Not allowed:

- patient names;
- patient IDs;
- medical record numbers;
- accession numbers;
- direct specimen identifiers;
- any identifier that can reasonably identify a person or clinical specimen.

Because v0.2.0 includes Sample-ID in Excel export, external sharing should use only synthetic/anonymized Sample-IDs and the exported workbook must be reviewed before sharing.

## Breakpoint behavior

Normal research-local plate entry does not require Breakpoint configuration.

- Breakpoint selection is not shown in the 96-well plate entry screen.
- Normal save does not send `breakpointSetId`.
- Saving without Breakpoint is valid.
- MIC/SIR recalculation is skipped when `breakpointSetId` is absent.
- BreakpointSet lifecycle, immutability, and management code remain for compatibility, historical records, and future controlled-production re-review.

This release does not authorize clinical interpretation from Breakpoint rules.

## Validation summary

The following validation was reported as passing before this release-candidate documentation update:

- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm test:e2e`

After final commit/tag creation, record the exact commit SHA, GitHub Actions run URL, and smoke-test evidence in the research-local evidence file.

## Remaining conditions before using this release candidate

- Record final release commit SHA.
- Record GitHub Actions evidence for the release commit, if available.
- Complete research-local smoke test using synthetic/anonymized data.
- Confirm Excel output contains no patient identifiers, notes, or unintended identifying data.
- Confirm generated output is handled as research/non-clinical only.

## Final statement

`v0.2.0-research-local` is acceptable as a research/local/non-clinical release candidate after the local smoke test passes and evidence is recorded.

Clinical, diagnostic, regulated, or controlled production use remains **NO-GO**.
