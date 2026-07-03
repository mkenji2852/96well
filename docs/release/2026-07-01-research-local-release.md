# 2026-07-01 Research Local Release

> Historical research-local record.
>
> This record predates `v0.2.0-research-local`. For the current Sample-ID -> drug layout -> 96-well workflow, Breakpoint-free save behavior, and Sample-ID-in-Excel policy, use the 2026-07-02 v0.2.0 release records.

## Release summary

This record re-scopes the 96well application for research-only, local, non-clinical use.

The controlled production deployment decision remains separate. Production or clinical deployment still requires completed production evidence, environment verification, database role verification, backup/restore evidence, BreakpointSet contentHash verification, smoke test evidence, and sign-off.

For the research-local scope below, the application is acceptable to use as a local research tool with synthetic, anonymized, or otherwise non-clinical data.

## Release decision

**CONDITIONAL GO for research-only local non-clinical use.**

**NO-GO for clinical, diagnostic, regulated, or controlled production use.**

The GO decision applies only when all scope and conditions in this document are followed.

## Intended use

- Local research or prototype evaluation.
- 96-well plate data entry using local application state and local database storage.
- MIC and S/I/R calculation behavior review using non-clinical data.
- Excel export format review and controlled sharing of non-clinical or anonymized outputs.
- Assistive image-analysis workflow evaluation where results are reviewed manually.

## Explicit non-use

Do not use this release for:

- clinical diagnosis;
- patient care;
- treatment or prescribing decisions;
- official clinical laboratory reporting;
- regulated production operation;
- storing patient-identifying data;
- sharing files that contain patient identifiers or institution-restricted identifiers.

## Data policy for this release

- Use synthetic, anonymized, or research-only data.
- Do not enter patient name, patient ID, medical record number, accession number, or direct specimen identifier.
- Do not place identifying data in sample code, organism labels, notes, image filenames, or uploaded images.
- Review Excel output before sharing outside the local environment.
- Prefer the `ANONYMIZED` export profile for external sharing.
- Treat image analysis as assistive only; manual review remains required.

## Local runtime profile

This release is intended to run in development/local mode, not production runtime mode.

Recommended local profile:

- `NODE_ENV=development`
- SQLite local database via `DATABASE_URL="file:./dev.db"`
- optional development authentication only with `DEV_AUTH_ENABLED=true`
- seeded local user such as `dev-admin` from `pnpm db:seed`

Production runtime rules remain unchanged:

- production must not use SQLite;
- production must fail closed when PostgreSQL runtime URL is missing;
- production must not use development authentication;
- production deployment still requires the controlled production evidence workflow.

## Controls retained

Even under research-local use, the implemented safety controls remain in place:

- route handlers still enforce authentication and permission checks where applicable;
- development authentication is limited to `NODE_ENV=development`;
- organization-scoped APIs remain scoped;
- image predictions remain separate from reviewed final results;
- confidence does not bypass manual review;
- RawMic and SirInterpretation records remain append-only;
- current-result uniqueness remains enforced by the available local schema constraints;
- BreakpointSet lifecycle remains `DRAFT -> APPROVED -> RETIRED`;
- approved BreakpointSet content hashes are used for reproducibility checks;
- Excel export defaults to `ANONYMIZED`;
- Excel formula-injection protection remains enabled.

## Minimum pre-use checks

Before using this release locally, run:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm test
pnpm build
pnpm dev
```

If Prisma CLI migration is unavailable in the local environment, `pnpm db:init` may be used to initialize the local SQLite database from checked-in SQLite migrations, followed by `pnpm db:seed`.

The local application should open at:

```text
http://127.0.0.1:3000
```

## Local verification checklist

- [ ] Application opens locally.
- [ ] Seed user and organization exist.
- [ ] Sample creation or lookup works with research data.
- [ ] 96-well plate entry screen is usable.
- [ ] Plate save works locally.
- [ ] MIC/S/I/R calculation can be reviewed with non-clinical data.
- [ ] Image-review UI, if enabled, shows predictions as unverified assistive information.
- [ ] Excel export uses `ANONYMIZED` by default.
- [ ] Exported workbook contains no patient-identifying information.
- [ ] No clinical or diagnostic result is issued from this local release.

## Evidence expectations

Production evidence is not required for research-local use.

Recommended lightweight local evidence:

- local commit SHA;
- date of local verification;
- operator;
- `pnpm lint` result;
- `pnpm test` result;
- `pnpm build` result;
- note confirming data is synthetic, anonymized, or non-clinical.

## Known limitations accepted for this scope

- No completed controlled production deployment evidence is required.
- Production database role separation is not verified for local SQLite use.
- Production OIDC provider configuration is not required for local development authentication.
- Backup/restore rehearsal is not required for disposable local research databases.
- Local SQLite does not provide the same operational guarantees as PostgreSQL production hardening.
- This release does not create a validated clinical device or regulated laboratory system.

## Escalation back to production scope

If the intended use changes to clinical, diagnostic, regulated, shared production, or patient-identifying data handling, this research-local GO no longer applies.

In that case, return to the controlled production deployment process and complete:

- production release readiness review;
- production environment variable verification;
- PostgreSQL migration and hardening verification;
- DB role separation verification;
- backup and restore rehearsal;
- latest APPROVED BreakpointSet contentHash verification;
- production smoke test;
- sign-off.
