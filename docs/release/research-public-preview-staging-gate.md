# Research-public preview staging gate

Date: 2026-07-10

Track: `v0.3.0-research-public-preview`

Branch: `feat/research-public-mvp`

Phase 1 implementation commit: `f1f5c0e Add research-public Phase 1 guardrails`

## Release classification

- Intended use: research / limited external / non-clinical.
- Data: synthetic/anonymized non-clinical data only.
- Users: small allow-listed research group.
- Access: internet reachable only after explicit access controls are configured and verified.
- Not for: clinical diagnosis, official laboratory reporting, regulated use, controlled production, or anonymous public access.

## CI evidence

Operator-provided current state:

- `sqlite-unit`: success
- `postgres-integration`: success
- `e2e`: success
- `research-public-guardrails`: success

Record the actual GitHub Actions run URL in [Staging readiness evidence](../deployment/research-public/evidence/staging-readiness-template.md) before deployment work begins.

## Phase 1 implementation confirmation

Confirmed from repository code and tests:

- Research-public production is detected by `RESEARCH_PUBLIC_MODE=true` and `NODE_ENV=production`.
- Production runtime requires `POSTGRES_APP_DATABASE_URL`.
- SQLite runtime is rejected in production.
- Migration credential is not used as runtime fallback.
- Research-public runtime rejects app and migration DB URLs being identical.
- Cloudflare Access JWT is required in research-public production.
- Access JWT signature, issuer, audience, expiration, and required configuration are verified.
- Allowed-host check is implemented as defense in depth.
- Middleware applies the Access perimeter to page/API requests.
- `requireAuthenticatedUser` also invokes the research-public perimeter, so direct API calls do not rely only on middleware.
- Existing OIDC path remains supported; browser users can be resolved by verified Cloudflare Access `sub` mapped to DB `User.externalSubject`.
- DB-backed User, RBAC, and organization-scope checks remain required.
- Image upload is server-side disabled by default in research-public production.
- Disabled image upload returns before form parsing, FastAPI image analysis, or image prediction creation.
- Research-public CI guardrail executes lint and dedicated research-public tests.

## Remaining blockers before sharing a preview link

1. Initial staging DB users and `User.externalSubject` mapping must be bootstrapped from verified Cloudflare Access `sub` values.
2. Browser staging must prove `/api/me` works for known Access subjects and rejects unknown subjects.
3. External PostgreSQL provider, region, pooling mode, backup, and deletion procedure must be selected.
4. Runtime and migration credentials must be separated and verified.
5. Netlify direct URL, deploy-preview, and branch-deploy exposure must be tested against real deployment behavior.
6. Real Cloudflare Access application settings must be verified.
7. Staging smoke test evidence must be completed.

## Gate decision

- Phase 1 code readiness: **GO** based on CI success and implemented guardrails.
- Staging environment creation: **CONDITIONAL GO** after provider, user bootstrap, and credential-separation decisions are recorded.
- Staging deployment: **CONDITIONAL GO** only after environment creation prerequisites are satisfied.
- Netlify limited external preview sharing: **NO-GO** until smoke test evidence is complete.
- Anonymous public use: **NO-GO**.
- Clinical / diagnostic / regulated / controlled production: **NO-GO**.

## Related documents

- [Research-public README](../deployment/research-public/README.md)
- [Staging readiness checklist](../deployment/research-public/staging-readiness-checklist.md)
- [Staging deployment runbook](../deployment/research-public/staging-deployment-runbook.md)
- [Staging smoke test](../deployment/research-public/staging-smoke-test.md)
- [Rollback and cleanup](../deployment/research-public/rollback-and-cleanup.md)
- [Provider decision](../deployment/research-public/provider-decision.md)
- [Staging readiness evidence template](../deployment/research-public/evidence/staging-readiness-template.md)
- [Staging smoke test evidence template](../deployment/research-public/evidence/staging-smoke-test-template.md)
