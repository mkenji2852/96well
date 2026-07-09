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
- [Release preview plan](../../release/2026-07-07-research-public-preview-plan.md)

This package intentionally does not deploy Netlify, create external PostgreSQL, configure Cloudflare, register secrets, or run production migrations.

