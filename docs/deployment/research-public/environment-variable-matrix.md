# Environment variable matrix

Date: 2026-07-07

Do not place real values in repository files. All production or preview secrets must be stored in the deployment platform secret manager.

| Variable | Classification | Secret? | Netlify runtime? | Notes |
| --- | --- | ---: | ---: | --- |
| `NODE_ENV=production` | Netlify runtime required | No | Yes | Required for production-mode behavior. |
| `POSTGRES_APP_DATABASE_URL` | Netlify runtime required | Yes | Yes | App-user PostgreSQL connection only. Prefer pooled/serverless-safe URL. |
| `POSTGRES_PRISMA_DATABASE_URL` | Migration only | Yes | No | Migration-user connection. Do not expose to Netlify runtime. |
| `POSTGRES_TEST_DATABASE_URL` | CI only | Yes | No | PostgreSQL integration tests. |
| `POSTGRES_APP_TEST_DATABASE_URL` | CI only | Yes | No | App-user privilege tests. |
| `POSTGRES_RESTORE_TEST_DATABASE_URL` | CI only | Yes | No | Backup/restore rehearsal. |
| `DATABASE_URL` | Local development only | Usually no for SQLite | No for preview | SQLite local DB. Must not be used in internet-reachable preview runtime. |
| `OIDC_ISSUER` | Optional auth provider config | No/metadata | If OIDC path used | Required for OIDC Bearer token mode. |
| `OIDC_AUDIENCE` | Optional auth provider config | No/metadata | If OIDC path used | Required for OIDC Bearer token mode. |
| `OIDC_JWKS_URL` | Optional auth provider config | No/metadata | If OIDC path used | Required for OIDC Bearer token verification. |
| `DEV_AUTH_ENABLED` | Local development only | No | No | Must not be enabled outside development. |
| `DEV_AUTH_USER_ID` | Local development only | Sensitive identifier | No | Requires existing DB user for local dev only. |
| `RESEARCH_PUBLIC_MODE` | Research-public runtime control | No | Yes if used | Proposed preview mode; not clinical/controlled production. |
| `RESEARCH_PUBLIC_BASIC_AUTH_ENABLED` | Defense-in-depth auth control | No | Optional | Do not use Basic Auth as the only internet-facing control. |
| `RESEARCH_PUBLIC_BASIC_USER` | Defense-in-depth auth control | Sensitive | Optional | Store as secret if used. |
| `RESEARCH_PUBLIC_BASIC_PASSWORD` | Defense-in-depth auth control | Yes | Optional | Strong random secret if used. |
| `RESEARCH_PUBLIC_AUTH_USER_ID` | App identity mapping | Sensitive identifier | Optional | Maps Basic-auth success to a DB user. Role/org still DB-backed. |
| `RESEARCH_PUBLIC_ALLOW_SQLITE` | Local-only research exception | No | No | Must be false/absent for Netlify limited external preview. |
| `NEXT_PUBLIC_IMAGE_REVIEW_ENABLED` | Browser-exposed feature flag | No | Yes | Set to `false` for Phase 1. Browser-visible; never secret. |
| `IMAGE_ANALYSIS_URL` | Image service only | Internal URL maybe sensitive | No for Phase 1 | Phase 2 external service endpoint. |

## Phase 1 Netlify runtime minimum

- `NODE_ENV=production`
- `POSTGRES_APP_DATABASE_URL`
- access-control variables selected by the final authentication design
- `NEXT_PUBLIC_IMAGE_REVIEW_ENABLED=false`

Do not configure migration credentials in the Netlify runtime environment.

