# Research Local Checklist

Use this checklist to make the final local research-use decision.

Completed research-local evidence can be recorded in [2026-07-02 Research Local v0.2.0 Smoke Test Evidence](./research-local-evidence/2026-07-02-research-local-smoke-test.md).

## Local environment

- [ ] Running locally only.
- [ ] No production deployment is being performed.
- [ ] `.env` is local/development only.
- [ ] SQLite local database is used.
- [ ] Production PostgreSQL migration is not being run for this local release.
- [ ] No real credentials or production URLs are recorded in local documents.

## Data scope

- [ ] Synthetic, anonymized, or non-clinical data only.
- [ ] Sample-ID is synthetic/anonymized research-local ID only.
- [ ] No patient names.
- [ ] No patient IDs.
- [ ] No medical record numbers.
- [ ] No accession numbers or direct specimen identifiers.
- [ ] No patient-identifying information in notes.
- [ ] No patient-identifying information in images or image filenames.

## Use restrictions

- [ ] No clinical decision use.
- [ ] No diagnostic use.
- [ ] No treatment or prescribing decision use.
- [ ] No official laboratory reporting.
- [ ] No regulated or controlled production operation.

## Local validation

- [ ] `pnpm lint` passed.
- [ ] `pnpm test` passed.
- [ ] `pnpm build` passed.
- [ ] Local application opens.
- [ ] Research local smoke test completed.

## v0.2.0 plate-entry workflow

- [ ] Sample-ID screen opens.
- [ ] Organism can be entered manually.
- [ ] Organism can be selected from the list.
- [ ] Existing Sample/Plate can be opened when present.
- [ ] Drug-layout screen opens before plate entry.
- [ ] A-H row usage can be selected.
- [ ] Drug name, unit, and 12 concentrations can be configured.
- [ ] 96-well grid displays configured drug and concentration.
- [ ] Right-click lower-concentration growth action works.
- [ ] Plate can be saved without Breakpoint configuration.
- [ ] Sample-ID return button works from plate entry.

## Excel export

- [ ] `ANONYMIZED` export profile was used by default.
- [ ] Sample-ID in the workbook is synthetic/anonymized and non-clinical only.
- [ ] Exported workbook was reviewed before sharing.
- [ ] Exported workbook contains no patient identifiers.
- [ ] Exported workbook contains no notes or identifiers that should be excluded from anonymized sharing.
- [ ] Output is clearly treated as research/non-clinical output.

## Final decision

- [ ] GO for research/local/non-clinical use.
- [ ] CONDITIONAL GO for research/local/non-clinical use, with follow-up items listed below.
- [ ] NO-GO for research/local/non-clinical use.

Follow-up items:

```text
<record local follow-up items here>
```

Clinical, diagnostic, regulated, and controlled production use remains **NO-GO** unless the separate production evidence workflow is completed.
