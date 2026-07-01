# 2026-07-01 Research Local Release Notes

## Release name

96well Research Local Release Candidate, 2026-07-01.

## Scope

This release candidate is scoped to research-only, local, non-clinical use.

It is intended for local evaluation of:

- 96-well plate input;
- local sample and plate workflows;
- MIC and S/I/R calculation behavior with non-clinical data;
- assistive image-review workflows;
- anonymized Excel export behavior.

## Intended use

- Research and prototype evaluation.
- Synthetic, anonymized, or otherwise non-clinical data only.
- Local SQLite database.
- Development/local authentication.
- Local operator review before any Excel file is shared.

## Not intended use

This release candidate must not be used for:

- clinical diagnosis;
- patient care;
- treatment or prescribing decisions;
- official clinical laboratory reporting;
- regulated or controlled production operation;
- patient-identifying data;
- production shared infrastructure.

## Major implemented controls

The following controls remain implemented and are not relaxed by this research-local release:

- authentication and authorization checks in API route handlers;
- development authentication limited to development/local use;
- organization-scoped access checks;
- image predictions separated from reviewed final results;
- mandatory manual review for image-assisted results;
- RawMic and SirInterpretation append-only history;
- BreakpointSet `DRAFT -> APPROVED -> RETIRED` lifecycle;
- contentHash-based BreakpointSet reproducibility checks;
- Excel `ANONYMIZED` profile as the default export profile;
- Excel formula-injection mitigation.

## Known limitations

- This is not a validated clinical or regulated system.
- Local SQLite does not provide the same operational guarantees as PostgreSQL production hardening.
- Production OIDC, PostgreSQL role separation, backup/restore, and production smoke evidence are not required for this local research scope.
- Image analysis remains assistive only and must not be treated as a final result.
- Exported Excel files must be reviewed by the operator before sharing.

## Validation summary

Required local validation for this release candidate:

- `pnpm lint`
- `pnpm test`
- `pnpm build`
- research-local smoke test
- confirmation that only synthetic, anonymized, or non-clinical data is used

PostgreSQL production integration tests are not required for this research-local release candidate, because this scope does not use controlled production PostgreSQL deployment.

## Release decision

**GO for research/local/non-clinical use if the local smoke test passes.**

**NO-GO for clinical/diagnostic/regulated/controlled production use.**

If the intended use changes to clinical, diagnostic, regulated, production, or patient-identifying data handling, this release decision is void and the controlled production evidence workflow must be completed.

