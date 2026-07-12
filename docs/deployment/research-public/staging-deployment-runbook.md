# Staging deployment runbook: research-public preview

Date: 2026-07-10

Purpose: describe the safe, provider-neutral sequence for creating a staging deployment for the research-public preview. Do not use this as a clinical, diagnostic, regulated, or controlled production runbook.

This document is a procedure draft. It does not create a Netlify site, Cloudflare Access application, DNS record, external database, secret, or migration.

## Preconditions

- Phase 1 code readiness is complete and CI is green.
- Staging readiness checklist has a GO or conditional GO with all conditions satisfied.
- Data classification is research / limited external / non-clinical.
- Only synthetic/anonymized research IDs are allowed.
- Image upload and image analysis remain disabled.
- No patient identifiers or official laboratory reporting.

## Required approvals

- Technical owner approval for staging environment creation.
- Data owner approval that only synthetic/anonymized non-clinical data will be used.
- Security owner approval for Access configuration, runtime secret placement, and DB role separation.

## Required CI evidence

Record:

- Commit SHA.
- PR link or number.
- GitHub Actions run URL.
- `sqlite-unit`: success.
- `postgres-integration`: success.
- `e2e`: success.
- `research-public-guardrails`: success.

## Provider-neutral staging architecture

```text
Authorized research user
  -> Cloudflare Access
  -> Custom staging domain
  -> Netlify Next.js application
  -> External PostgreSQL app-user pooled/runtime connection
```

Migration uses a separate migration credential outside the Netlify runtime.

## Step 1: select and prepare PostgreSQL provider

1. Choose provider using [Provider decision](./provider-decision.md).
2. Create a staging PostgreSQL database.
3. Record provider, region, database name/reference, and backup policy in the evidence template.
4. Create or identify:
   - migration/admin credential for migration only;
   - application runtime credential for Netlify runtime only;
   - optional readonly/audit credential.
5. Confirm the application runtime credential cannot perform DDL.

Do not place the migration credential in Netlify runtime variables.

## Step 2: run staging migration through controlled path

Use the actual package scripts from `package.json`:

```bash
pnpm prisma:postgres:generate
pnpm prisma:postgres:validate
pnpm prisma:postgres:migrate
pnpm postgres:hardening
```

Then apply least-privilege roles if required:

```bash
psql -v ON_ERROR_STOP=1 -v db_name=<STAGING_DB> -v app_user=<APP_USER> -v migration_user=<MIGRATION_USER> -v readonly_user=<READONLY_USER> -f prisma/postgresql/hardening/roles.sql
```

Notes:

- Use placeholders above only in repository docs.
- Run with the migration credential outside Netlify runtime.
- Retain migration logs.
- Stop on any migration, hardening, trigger, or role-grant failure.

## Step 3: seed/bootstrap staging application identity

The app still requires existing application authentication after Cloudflare Access.

Required bootstrap:

1. Create/verify a staging `Organization`.
2. Create/verify DB `User` records for allowed research users.
3. Map each user through `User.externalSubject` to the verified Cloudflare Access JWT `sub` used for browser access.
4. Assign least-privilege roles appropriate for research preview.
5. Confirm role and organization come from DB values, not token claims.

OIDC Bearer authentication remains supported for API clients that send an Authorization header, but browser staging can use the verified Cloudflare Access subject mapping. Unknown Access subjects must fail closed; do not auto-provision users and do not auto-assign ADMIN.

## Step 4: configure Cloudflare Access

1. Configure Access for the custom staging hostname.
2. Allow only approved research users/groups.
3. Record:
   - team domain / issuer;
   - application AUD;
   - canonical staging host;
   - Access session policy;
   - preview/branch-deploy policy.
4. Configure app-side variables in Netlify runtime:
   - `CLOUDFLARE_ACCESS_TEAM_DOMAIN`;
   - `CLOUDFLARE_ACCESS_AUD`;
   - optional `CLOUDFLARE_ACCESS_JWKS_URL`;
   - `RESEARCH_PUBLIC_ALLOWED_HOSTS`.

Do not rely on Cloudflare Access alone. The app-side JWT check remains the backstop against direct-origin access.

## Step 5: configure Netlify staging runtime

Required runtime:

- `NODE_ENV=production`
- `RESEARCH_PUBLIC_MODE=true`
- `POSTGRES_APP_DATABASE_URL`
- OIDC variables if API clients will use existing OIDC Bearer auth
- Cloudflare Access variables
- `NEXT_PUBLIC_IMAGE_REVIEW_ENABLED=false`
- `RESEARCH_PUBLIC_IMAGE_REVIEW_ENABLED=false`
- `RESEARCH_PUBLIC_IMAGE_UPLOAD_ENABLED=false`

Forbidden in Netlify runtime:

- SQLite `DATABASE_URL`
- `POSTGRES_PRISMA_DATABASE_URL`
- migration/admin DB credential
- `IMAGE_ANALYSIS_URL` for Phase 1
- real patient data or sample identifiers

## Step 6: deploy staging

1. Deploy from approved commit.
2. Confirm build uses Node 22 and `pnpm build`.
3. Confirm no deploy logs expose secrets or database URLs.
4. Confirm deployment URL is not shared before smoke test completes.

## Step 7: smoke test

Run [Staging smoke test](./staging-smoke-test.md) using synthetic/anonymized non-clinical data only.

Stop validation immediately if:

- anonymous access succeeds;
- direct Netlify origin bypass succeeds;
- API direct access succeeds without Access JWT;
- runtime uses SQLite;
- image upload succeeds in Phase 1;
- Access subject mapping, OIDC/RBAC, or organization-scope checks fail;
- Excel export leaks identifiers beyond allowed synthetic/anonymized Sample-ID.

## Evidence to retain

- CI run URL and commit SHA.
- Provider and region.
- Migration/hardening logs.
- Role-grant logs.
- Runtime environment checklist with secret values redacted.
- Cloudflare Access settings summary.
- Smoke test evidence.
- Rollback/cleanup readiness confirmation.
