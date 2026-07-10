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
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | Runtime non-secret config | No/metadata | Yes | Used to build the Access issuer and JWKS URL. |
| `CLOUDFLARE_ACCESS_AUD` | Runtime non-secret config | No/metadata | Yes | Cloudflare Access application audience. |
| `CLOUDFLARE_ACCESS_JWKS_URL` | Runtime non-secret config | No/metadata | Optional | Override only when necessary; defaults to the team-domain certs endpoint. |
| `RESEARCH_PUBLIC_ALLOWED_HOSTS` | Runtime non-secret config | No | Yes | Comma-separated canonical hosts. Direct Netlify hosts are rejected unless explicitly listed. |
| `RESEARCH_PUBLIC_IMAGE_REVIEW_ENABLED` | Runtime non-secret config | No | Yes | Must be `false`/absent for Phase 1 unless Phase 2 storage/service controls exist. |
| `RESEARCH_PUBLIC_IMAGE_UPLOAD_ENABLED` | Runtime non-secret config | No | Yes | Must be `false`/absent for Phase 1. Server-side upload default is deny. |
| `NEXT_PUBLIC_IMAGE_REVIEW_ENABLED` | Browser-exposed feature flag | No | Yes | Set to `false` for Phase 1. Browser-visible; never secret. |
| `IMAGE_ANALYSIS_URL` | Image service only | Internal URL maybe sensitive | No for Phase 1 | Phase 2 external service endpoint. |

## Phase 1 Netlify runtime minimum

- `NODE_ENV=production`
- `POSTGRES_APP_DATABASE_URL`
- OIDC configuration for existing application authentication
- Cloudflare Access verification variables
- `RESEARCH_PUBLIC_ALLOWED_HOSTS`
- `NEXT_PUBLIC_IMAGE_REVIEW_ENABLED=false`
- `RESEARCH_PUBLIC_IMAGE_REVIEW_ENABLED=false`
- `RESEARCH_PUBLIC_IMAGE_UPLOAD_ENABLED=false`

Do not configure migration credentials in the Netlify runtime environment.

