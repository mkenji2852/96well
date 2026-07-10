# Phased deployment plan

Date: 2026-07-07

## Phase 0: design audit

Status: this document set.

Deliverables:

- Architecture decision.
- Netlify readiness review.
- Threat model.
- Environment variable matrix.
- Preview release plan.

No external deployment or secret registration is performed in this phase.

## Phase 1: limited external research staging

Goal: small authorized research-user preview, no anonymous access, no clinical use.

Implementation sequence:

1. Create `feat/research-public-mvp` from a clean baseline after current v0.2.0 work is committed or intentionally separated.
2. Keep research-local and research-public release tracks separate.
3. Add a Netlify deployment profile and document the exact Next.js runtime assumptions.
4. Require external PostgreSQL in internet-reachable runtime. SQLite fallback is fail-closed in research-public production.
5. Use app-user `POSTGRES_APP_DATABASE_URL` at runtime only.
6. Keep migration-user `POSTGRES_PRISMA_DATABASE_URL` in manual release procedure or protected CI only.
7. Add server-side feature enforcement for image-disabled mode. Direct image upload APIs return a controlled disabled response when Phase 1 image features are off.
8. Hide or disable image upload UI in all entry points, including the plate editor.
9. Configure Cloudflare Access for the canonical domain.
10. Add origin-bypass controls for `*.netlify.app`, deploy previews, and branch deploys.
11. App-side Cloudflare Access JWT verification is implemented as the Phase 1 origin verification backstop; staging must still validate real Cloudflare/Netlify behavior.
12. Add serverless PostgreSQL pooling guidance and smoke tests.
13. Add research-public CI checks: production env validation, image-disabled E2E, auth-boundary tests, and Netlify-compatible build.
14. Run staging smoke tests with synthetic/anonymized data only.
15. Record evidence before preview access is shared.

Phase 1 acceptance gates:

- No anonymous access.
- Direct Netlify origin path denied or protected.
- SQLite not used at runtime.
- Image upload disabled server-side and UI-side.
- External PostgreSQL app-user runtime works.
- Migration credentials absent from runtime.
- Excel ANONYMIZED export works for small data.
- No patient identifiers or clinical data.

## Phase 2: image analysis and storage

Only after Phase 1 is stable:

- Deploy image analysis as an external service.
- Add authenticated service-to-service calls.
- Add object storage for uploaded images.
- Add file size/type controls, retention policy, and storage access control.
- Add image-disabled fallback and review-only safety controls.

## Phase 3: limited research preview release

- Publish `v0.3.0-research-public-preview` only after Phase 1 staging evidence is complete.
- Continue to label the app as research / limited external / non-clinical.
- Keep clinical, diagnostic, regulated, and controlled production use as NO-GO.

