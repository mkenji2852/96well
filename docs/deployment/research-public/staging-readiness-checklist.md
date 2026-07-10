# Staging readiness checklist: research-public preview

Date: 2026-07-10

Purpose: decide whether the team may start creating a real staging environment for the `v0.3.0-research-public-preview` track. This checklist does not authorize a public preview link by itself.

Scope: research / limited external / non-clinical only. Do not use patient identifiers, clinical data, official laboratory reporting, diagnostic decisions, regulated data, or controlled production evidence in this staging track.

## Phase 1 implementation evidence

- [ ] Branch is `feat/research-public-mvp`.
- [ ] Phase 1 implementation commit recorded: `f1f5c0e Add research-public Phase 1 guardrails`.
- [ ] Pull request is created and reviewed.
- [ ] GitHub Actions passed:
  - [ ] `sqlite-unit`
  - [ ] `postgres-integration`
  - [ ] `e2e`
  - [ ] `research-public-guardrails`
- [ ] Local validation evidence retained:
  - [ ] `pnpm lint`
  - [ ] `pnpm test`
  - [ ] `pnpm build`
  - [ ] `pnpm test:e2e`

## Code-control confirmation

- [ ] `RESEARCH_PUBLIC_MODE=true` and `NODE_ENV=production` enable research-public fail-closed behavior.
- [ ] SQLite runtime is rejected in production and research-public runtime.
- [ ] `POSTGRES_APP_DATABASE_URL` is required for runtime.
- [ ] `POSTGRES_PRISMA_DATABASE_URL` is not used as runtime fallback.
- [ ] Runtime rejects using the same value for app and migration DB credentials in research-public production.
- [ ] Cloudflare Access JWT is required in research-public production.
- [ ] Access JWT signature, issuer, audience, expiration, and required config are verified fail-closed.
- [ ] `RESEARCH_PUBLIC_ALLOWED_HOSTS` is configured for canonical staging hostnames.
- [ ] Middleware guards page and API entry points.
- [ ] API route handlers continue to call existing `requireAuthenticatedUser`, RBAC, and organization-scope checks.
- [ ] Image upload is disabled server-side by default.
- [ ] Disabled image upload returns a controlled API response before form parsing, image analysis, or DB writes.
- [ ] Disabled image feature does not call FastAPI/OpenCV service.

## Staging architecture gate

- [ ] Target architecture is:

```text
Authorized research user
  -> Cloudflare Access
  -> Custom staging domain
  -> Netlify Next.js
  -> External PostgreSQL
```

- [ ] No anonymous access.
- [ ] No direct Netlify origin bypass.
- [ ] No deploy-preview or branch-deploy exposure without equivalent Access/JWT controls.
- [ ] No local filesystem persistence assumption.
- [ ] No SQLite runtime.
- [ ] Image upload and image analysis remain disabled for Phase 1.
- [ ] Synthetic/anonymized non-clinical data only.

## Provider and database gate

- [ ] PostgreSQL provider selected.
- [ ] Provider supports pooled/serverless runtime URL.
- [ ] Provider supports direct migration/admin URL or equivalent controlled migration path.
- [ ] Region selected and recorded.
- [ ] Backup/restore capability identified.
- [ ] Staging DB deletion/cleanup procedure understood.
- [ ] Runtime application user and migration user can be separated.
- [ ] Netlify runtime will receive only the app-user runtime credential.

## Authentication and UX gate

- [ ] Cloudflare Access application planned for the custom staging hostname.
- [ ] Allowed research users/emails/groups defined.
- [ ] Cloudflare Access application AUD to be recorded in secret manager.
- [ ] Team domain/issuer to be recorded in runtime config.
- [ ] Existing application authentication UX is resolved.
- [ ] Database `User.externalSubject` mapping plan exists for each staging user.
- [ ] Decision recorded: Cloudflare Access alone is not treated as app RBAC identity.
- [ ] If the browser UI needs an OIDC token, the login/token acquisition flow is confirmed before sharing preview access.

## Environment-variable gate

- [ ] Required runtime values identified in [Environment variable matrix](./environment-variable-matrix.md).
- [ ] No real secrets committed to repository files.
- [ ] `NEXT_PUBLIC_*` contains no secret.
- [ ] `POSTGRES_PRISMA_DATABASE_URL` absent from Netlify runtime environment.
- [ ] `IMAGE_ANALYSIS_URL` absent for Phase 1.
- [ ] `NEXT_PUBLIC_IMAGE_REVIEW_ENABLED=false`.
- [ ] `RESEARCH_PUBLIC_IMAGE_REVIEW_ENABLED=false`.
- [ ] `RESEARCH_PUBLIC_IMAGE_UPLOAD_ENABLED=false`.

## Staging decision

- [ ] GO to create staging environment.
- [ ] CONDITIONAL GO to create staging environment after listed conditions.
- [ ] NO-GO.

Decision notes:

- Record unresolved blockers and owner before any staging environment is created.
- CI success alone is not sufficient to deploy or share a preview link.
