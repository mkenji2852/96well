# Research limited external preview

This directory is the design-audit package for the proposed `v0.3.0-research-public-preview` track.

Scope:

- Intended use: research / limited external / non-clinical only.
- Access model: small allow-listed research users, internet reachable, no anonymous access.
- Not intended for: clinical diagnosis, official laboratory reporting, regulated use, or controlled production.
- Data policy: synthetic or anonymized non-clinical data only. Do not enter patient identifiers.

Documents:

- [Architecture decision](./architecture-decision.md)
- [Netlify readiness review](./netlify-readiness-review.md)
- [Threat model](./threat-model.md)
- [Environment variable matrix](./environment-variable-matrix.md)
- [Phased deployment plan](./phased-deployment-plan.md)
- [Provider decision](./provider-decision.md)
- [Staging readiness checklist](./staging-readiness-checklist.md)
- [Staging deployment runbook](./staging-deployment-runbook.md)
- [Staging smoke test](./staging-smoke-test.md)
- [Rollback and cleanup](./rollback-and-cleanup.md)
- [Staging readiness evidence template](./evidence/staging-readiness-template.md)
- [Staging smoke test evidence template](./evidence/staging-smoke-test-template.md)
- [Release preview plan](../../release/2026-07-07-research-public-preview-plan.md)
- [Staging gate record](../../release/research-public-preview-staging-gate.md)

This package intentionally does not deploy Netlify, create external PostgreSQL, configure Cloudflare, register secrets, or run production migrations.

## Staging readiness flow

1. Confirm Phase 1 CI evidence.
2. Complete the [Staging readiness checklist](./staging-readiness-checklist.md).
3. Select the PostgreSQL provider using [Provider decision](./provider-decision.md).
4. Follow the [Staging deployment runbook](./staging-deployment-runbook.md) only after the readiness gate is satisfied.
5. Run the [Staging smoke test](./staging-smoke-test.md) before sharing any preview link.
6. Record evidence with the templates in [`evidence/`](./evidence/staging-readiness-template.md).
7. Use [Rollback and cleanup](./rollback-and-cleanup.md) if validation fails.

