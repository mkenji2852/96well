# 2026-07-02 Research Local v0.2.0 Release Notes

## Release name

`v0.2.0-research-local`

## Intended use

Research-only, local, non-clinical use with synthetic/anonymized data.

## Not intended use

This release is not for clinical diagnosis, patient care, official laboratory reporting, regulated operation, patient-identifying data, or controlled production deployment.

## Main changes

- Rebuilt the first screen around Sample-ID, organism, and plate selection.
- Added a drug-layout screen before 96-well entry.
- Allows drug name, unit, and 12 concentrations to be fixed per A-H row.
- Shows configured drug and concentration inside the 96-well grid.
- Added a button to return from plate entry to the Sample-ID screen.
- Removed Breakpoint selection from the normal plate entry/save flow.
- Allows plate save without Breakpoint configuration.
- Skips MIC/SIR recalculation when no `breakpointSetId` is supplied.
- Added a well right-click menu to mark lower concentrations in the same row as growth.
- Includes Sample-ID in Excel output with formula injection protection.
- Improved handling of non-JSON API responses so HTML error pages are not shown as raw JSON parse errors.

## Breakpoint compatibility

Breakpoint management and historical compatibility code remain in the repository.

They are retained for:

- historical records that already reference BreakpointSet data;
- administrative review;
- future controlled-production re-review if the application scope changes.

They are not part of the normal v0.2.0 research-local plate save path.

## Excel export note

`ANONYMIZED` remains the recommended export profile for external sharing.

For v0.2.0 research-local use, Excel export includes Sample-ID. This is acceptable only because Sample-ID must be synthetic/anonymized and non-clinical. Do not enter patient identifiers or direct specimen identifiers as Sample-ID.

## Known limitations

- Research-local use only.
- Local SQLite/development setup only.
- No clinical interpretation is authorized.
- No official laboratory report should be issued.
- Breakpoint-free saves do not produce formal MIC/SIR interpretation records.
- Excel files still require manual review before sharing.

## Validation summary

Reported passing before this documentation update:

- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm test:e2e`

## Release decision

- Research/local/non-clinical: **CONDITIONAL GO** after local smoke-test evidence is recorded.
- Clinical/diagnostic/regulated/controlled production: **NO-GO**.
