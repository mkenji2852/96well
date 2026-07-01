# Research Local Smoke Test

## Purpose

Use this smoke test before starting research-only, local, non-clinical use of the 96well application.

This smoke test does not authorize clinical, diagnostic, regulated, or controlled production use.

## Preconditions

- The application is running locally.
- `.env` uses local development settings.
- Local SQLite database is initialized and seeded.
- Test data is synthetic, anonymized, or non-clinical.
- No patient identifiers are used in sample code, notes, image filenames, images, or exports.

## Smoke test sequence

1. Local startup
   - Run `pnpm dev`.
   - Open `http://127.0.0.1:3000`.
   - Confirm the top page loads.

2. Data scope check
   - Confirm the sample used for testing is synthetic or anonymized.
   - Confirm no patient name, patient ID, accession number, medical record number, or direct specimen identifier is entered.

3. Sample and plate workflow
   - Create or open a synthetic/anonymized sample.
   - Create or open a plate.
   - Confirm the 96-well input screen is visible and usable.

4. 96-well input
   - Enter a small test pattern.
   - Save locally.
   - Confirm the save succeeds without using production infrastructure.

5. Image review screen
   - Open the image review screen if image review is enabled.
   - Confirm image predictions are shown as assistive/unverified information.
   - Confirm manual review remains required before approval.

6. MIC/SIR behavior
   - Confirm MIC/SIR results can be reviewed for synthetic/anonymized data.
   - Confirm results are understood as research output only.

7. Excel anonymized export
   - Export using the default profile.
   - Confirm the default is `ANONYMIZED`.
   - Open the workbook locally.
   - Confirm sample notes, actor identity, raw audit JSON, and patient-identifying information are absent.
   - Confirm the workbook is labeled or handled as research/non-clinical output.

8. Non-clinical use confirmation
   - Confirm no clinical diagnosis, treatment decision, or official laboratory report is issued from this run.

## Expected result

All smoke test steps pass with synthetic, anonymized, or non-clinical data.

## Failure handling

If any step fails:

- stop research-local release validation;
- do not bypass authentication, RBAC, manual review, append-only history, or immutability controls;
- do not share generated Excel files until the issue is understood;
- record the failure in local release notes or issue tracking.

