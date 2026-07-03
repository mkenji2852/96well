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
   - Confirm Sample-ID is a research-local synthetic/anonymized identifier, not a patient or specimen identifier.
   - Confirm the organism can be entered manually or selected from the common-organism list.
   - Create or open a plate.
   - Configure the drug layout before plate entry:
     - select at least one A-H row;
     - enter drug name;
     - enter unit;
     - enter 12 concentrations for columns 1-12.
   - Confirm the 96-well input screen is visible and usable.

4. 96-well input
   - Confirm each configured well displays drug name and concentration.
   - Enter a small test pattern.
   - Right-click a well and use the lower-concentration bulk action.
   - Confirm wells at lower concentrations in that row are marked as growth.
   - Save locally.
   - Confirm the save succeeds without using production infrastructure.
   - Confirm save succeeds even when no Breakpoint is configured.
   - Confirm the Sample-ID screen return button works.

5. Image review screen
   - Open the image review screen if image review is enabled.
   - Confirm image predictions are shown as assistive/unverified information.
   - Confirm manual review remains required before approval.

6. MIC/SIR behavior
   - Confirm normal Breakpoint-free plate save does not require MIC/SIR interpretation.
   - If a Breakpoint-backed calculation is intentionally tested, use synthetic/anonymized data only.
   - Confirm results are understood as research output only.

7. Excel anonymized export
   - Export using the default profile.
   - Confirm the default is `ANONYMIZED`.
   - Open the workbook locally.
   - Confirm Sample-ID is present only as a synthetic/anonymized research-local ID.
   - Confirm sample notes, actor identity, raw audit JSON, and patient-identifying information are absent.
   - Confirm the workbook is labeled or handled as research/non-clinical output.

8. Error handling
   - If an API error occurs, confirm the UI does not show raw `Unexpected token '<'` JSON parse text for HTML error pages.

9. Non-clinical use confirmation
   - Confirm no clinical diagnosis, treatment decision, or official laboratory report is issued from this run.

## Expected result

All smoke test steps pass with synthetic, anonymized, or non-clinical data.

## Failure handling

If any step fails:

- stop research-local release validation;
- do not bypass authentication, RBAC, manual review, append-only history, or immutability controls;
- do not share generated Excel files until the issue is understood;
- record the failure in local release notes or issue tracking.
