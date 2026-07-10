# Environment variable matrix

Date: 2026-07-10

Do not place real values in repository files. All staging secrets must be stored in the deployment platform secret manager. `NEXT_PUBLIC_*` values are browser-visible and must never contain secrets.

| Variable | Required? | Secret? | Browser/server | Staging runtime | Migration only | Placeholder/example | Validation behavior and missing behavior |
| --- | ---: | ---: | --- | ---: | ---: | --- | --- |
| `NODE_ENV=production` | Yes | No | Server/build | Yes | No | `production` | Required to activate production runtime behavior. |
| `RESEARCH_PUBLIC_MODE=true` | Yes | No | Server/build | Yes | No | `true` | With production, enables research-public Access and fail-closed checks. |
| `POSTGRES_APP_DATABASE_URL` | Yes | Yes | Server | Yes | No | secret-manager value only | Required in production runtime. Must be PostgreSQL. Missing or SQLite fails closed. Prefer pooled/serverless-safe app-user URL. |
| `POSTGRES_PRISMA_DATABASE_URL` | Yes for migration, forbidden at runtime | Yes | Server | No | Yes | secret-manager value only | Used only for controlled migration/hardening. Must not be configured in Netlify runtime. Runtime does not fall back to it. |
| `DATABASE_URL` | No for staging | Usually yes if remote | Server | No | No | not configured | SQLite/file values are forbidden in production runtime. Local SQLite is development-only. |
| `OIDC_ISSUER` | Yes if existing app auth uses OIDC | No/metadata | Server | Yes | No | issuer placeholder | Existing app authentication requires valid OIDC config in production. Missing config causes authenticated API calls to fail closed. |
| `OIDC_AUDIENCE` | Yes if OIDC used | No/metadata | Server | Yes | No | audience placeholder | Used for OIDC Bearer token audience verification. |
| `OIDC_JWKS_URL` | Yes if OIDC used | No/metadata | Server | Yes | No | JWKS placeholder | Used for OIDC JWT signature verification. |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | Yes | No/metadata | Server | Yes | No | team-domain placeholder | Required in research-public production. Builds issuer and default JWKS URL. Missing/invalid config fails closed. |
| `CLOUDFLARE_ACCESS_AUD` | Yes | No/metadata | Server | Yes | No | Access AUD placeholder | Required for Access JWT audience verification. Missing config fails closed. |
| `CLOUDFLARE_ACCESS_JWKS_URL` | Optional | No/metadata | Server | Optional | No | JWKS override placeholder | Optional override. If omitted, derived from team domain. Invalid URL fails closed. |
| `RESEARCH_PUBLIC_ALLOWED_HOSTS` | Yes | No | Server | Yes | No | comma-separated host placeholders | Required. Host not in allow-list fails closed. Use canonical staging hosts only. |
| `NEXT_PUBLIC_IMAGE_REVIEW_ENABLED` | Yes for Phase 1 | No | Browser | Yes | No | `false` | Browser-visible UI flag. Must be `false` in Phase 1. Not a security boundary. |
| `RESEARCH_PUBLIC_IMAGE_REVIEW_ENABLED` | Yes for Phase 1 | No | Server | Yes | No | `false` | Server-side review enablement. In research-public production, omitted/false disables image review. |
| `RESEARCH_PUBLIC_IMAGE_UPLOAD_ENABLED` | Yes for Phase 1 | No | Server | Yes | No | `false` | Server-side upload gate. In research-public production, omitted/false rejects upload before analysis. |
| `IMAGE_ANALYSIS_URL` | No for Phase 1 | Internal URL may be sensitive | Server | No | No | not configured | Phase 2 only. If image upload is disabled, the route returns before this service is called. |
| `DEV_AUTH_ENABLED` | No | No | Server | No | No | not configured | Development-only. If enabled outside development, auth fails closed. |
| `DEV_AUTH_USER_ID` | No | Sensitive identifier | Server | No | No | not configured | Development-only DB user ID. Do not configure in staging runtime. |
| `POSTGRES_TEST_DATABASE_URL` | No | Yes | CI | No | No | CI secret | CI PostgreSQL integration only. |
| `POSTGRES_APP_TEST_DATABASE_URL` | No | Yes | CI | No | No | CI secret | CI app-user privilege tests only. |
| `POSTGRES_RESTORE_TEST_DATABASE_URL` | No | Yes | CI | No | No | CI secret | CI restore rehearsal only. |

## Phase 1 Netlify runtime minimum

- `NODE_ENV=production`
- `RESEARCH_PUBLIC_MODE=true`
- `POSTGRES_APP_DATABASE_URL`
- OIDC configuration required by existing app authentication
- Cloudflare Access verification variables
- `RESEARCH_PUBLIC_ALLOWED_HOSTS`
- `NEXT_PUBLIC_IMAGE_REVIEW_ENABLED=false`
- `RESEARCH_PUBLIC_IMAGE_REVIEW_ENABLED=false`
- `RESEARCH_PUBLIC_IMAGE_UPLOAD_ENABLED=false`

## Explicitly forbidden in Netlify runtime

- SQLite `DATABASE_URL`
- `POSTGRES_PRISMA_DATABASE_URL`
- migration/admin DB credential
- `DEV_AUTH_ENABLED`
- `DEV_AUTH_USER_ID`
- `IMAGE_ANALYSIS_URL` for Phase 1
- any real patient identifiers or clinical data

## Credential split

- Runtime application credential: `POSTGRES_APP_DATABASE_URL`; least privilege; pooled/serverless-safe; stored only in Netlify runtime secret manager.
- Migration credential: `POSTGRES_PRISMA_DATABASE_URL`; migration and hardening only; stored outside Netlify runtime; used manually or from a protected CI release workflow.
