# v0.3.0 research-public-preview plan

Date: 2026-07-07

Planned branch: `feat/research-public-mvp`

Planned release candidate: `v0.3.0-research-public-preview`

Update: Phase 1 guardrails were implemented after this plan. Use [Research Public Preview Staging Gate](./research-public-preview-staging-gate.md) for the current staging-readiness decision.

## Release classification

- Intended use: research / limited external / non-clinical.
- Data: synthetic/anonymized non-clinical data only.
- Users: authorized small research group only.
- Access: internet reachable only behind explicit access controls.
- Not for: clinical diagnosis, official laboratory reporting, regulated use, controlled production, or anonymous public access.

## Current decision

- Start implementation: **CONDITIONAL GO** after current local-research work is cleanly separated.
- Netlify limited external research preview: **NO-GO today** until blockers in the design audit are resolved and staging evidence exists.
- Anonymous public use: **NO-GO**.
- Clinical / diagnostic / regulated / controlled production: **NO-GO**.

## Blockers before preview

1. Direct Netlify origin and deploy preview bypass must be closed.
2. Phase 1 must prohibit SQLite runtime and require external PostgreSQL.
3. Image upload/review must be disabled server-side and UI-side, or moved to a proper external service/storage design.
4. Netlify runtime compatibility must be tested with Next.js API routes, Prisma, and Excel export.
5. Runtime must use app-user DB credentials only; migration credentials must not be present.
6. Serverless PostgreSQL pooling/connection limits must be selected and tested.

## Required evidence before sharing a preview link

- CI success for lint, unit tests, build, E2E, and PostgreSQL integration.
- Netlify staging build success.
- External PostgreSQL staging migration performed by approved migration path.
- Runtime DB user privilege check.
- Cloudflare Access or equivalent access-control proof.
- Direct Netlify URL / deploy preview bypass test.
- Image-disabled UI/API smoke test.
- Excel ANONYMIZED export smoke test.
- Synthetic/anonymized data-only confirmation.

## Related design documents

- [Research-public architecture decision](../deployment/research-public/architecture-decision.md)
- [Netlify readiness review](../deployment/research-public/netlify-readiness-review.md)
- [Threat model](../deployment/research-public/threat-model.md)
- [Environment variable matrix](../deployment/research-public/environment-variable-matrix.md)
- [Phased deployment plan](../deployment/research-public/phased-deployment-plan.md)

