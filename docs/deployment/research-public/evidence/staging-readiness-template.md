# Research-public staging readiness evidence template

Date completed: `<YYYY-MM-DD>`

Do not record secrets, real database URLs, tokens, patient identifiers, clinical data, or private Access JWTs in this file.

## Metadata

- Verifier:
- Approver:
- Commit SHA:
- Pull request:
- GitHub Actions run URL:
- Provider selected:
- Region:
- Staging decision: `GO | CONDITIONAL GO | NO-GO`

## CI evidence

- `sqlite-unit`: `success | failed | not run`
- `postgres-integration`: `success | failed | not run`
- `e2e`: `success | failed | not run`
- `research-public-guardrails`: `success | failed | not run`

## Phase 1 implementation confirmation

- SQLite fail-closed in research-public production: `yes | no`
- `POSTGRES_APP_DATABASE_URL` required for runtime: `yes | no`
- Migration credential absent from runtime plan: `yes | no`
- Cloudflare Access JWT app-side verification implemented: `yes | no`
- Allowed host verification implemented: `yes | no`
- Existing app auth/RBAC/org scope preserved: `yes | no`
- Image upload disabled server-side by default: `yes | no`

## Staging architecture confirmation

- Custom staging domain planned:
- Cloudflare Access application planned:
- Netlify site/deploy target planned:
- External PostgreSQL provider planned:
- Runtime app DB credential separated from migration credential:
- Deploy preview/branch deploy policy:

## Environment-variable review

- `NODE_ENV=production`:
- `RESEARCH_PUBLIC_MODE=true`:
- `POSTGRES_APP_DATABASE_URL` configured as runtime app user:
- `POSTGRES_PRISMA_DATABASE_URL` excluded from runtime:
- OIDC issuer/audience/JWKS planned:
- Cloudflare Access team domain/AUD/JWKS planned:
- `RESEARCH_PUBLIC_ALLOWED_HOSTS` planned:
- Image flags disabled:

## Auth UX review

- Cloudflare Access user can reach app shell:
- Existing OIDC/app authentication path confirmed:
- DB `User.externalSubject` mapping plan:
- Role/organization from DB confirmed:
- Remaining UX blocker:

## GO / NO-GO

- Readiness decision:
- Conditions before environment creation:
- Conditions before staging deployment:
- Conditions before sharing preview link:

## Sign-off

- Technical owner:
- Security reviewer:
- Data owner:
- Timestamp:

