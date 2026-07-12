# PostgreSQL provider decision support: research-public staging

Date: 2026-07-10

Purpose: compare provider-neutral staging database options without creating an account, database, credential, or migration.

## Comparison matrix

| Criterion | Neon | Supabase PostgreSQL | Railway PostgreSQL | Prisma Postgres |
| --- | --- | --- | --- | --- |
| Serverless connection pooling | Strong fit; pooled URLs are a first-class staging option. | Available through pooler; verify transaction/session mode for Prisma. | Possible, but connection management must be reviewed for serverless runtime. | Prisma-oriented, but preview/maturity and operational details must be confirmed. |
| Pooled runtime URL | Yes, generally straightforward. | Yes, using pooler configuration. | Depends on plan/configuration. | Expected, but verify current provider docs before use. |
| Direct migration URL | Yes, direct connection available. | Yes, direct DB connection available. | Yes. | Verify exact migration path. |
| Prisma compatibility | Good common fit. | Good common fit; pooler mode requires care. | Likely compatible; validate in staging. | Designed for Prisma workflows; validate hardening SQL support. |
| Free/low-cost staging suitability | Good. Watch sleep/compute limits. | Good. Watch project limits. | Good for simple staging; watch service limits. | Potentially good; confirm availability and limits. |
| Connection limits | Better with pooled runtime URL; still monitor. | Pooler helps; direct limits can be low. | Plan-dependent. | Provider-dependent. |
| Backup options | Available depending on plan. | Available depending on plan. | Plan-dependent. | Provider-dependent. |
| Region | Multiple regions. | Multiple regions. | Multiple regions. | Verify available regions. |
| Operational simplicity | High for serverless app + pooled URL. | Moderate; broader platform features, more settings. | High for quick staging, but DB ops/hardening must be validated. | Potentially high for Prisma-centric use. |
| Vendor lock-in | Moderate. SQL remains portable; platform-specific connection strings. | Moderate. Extra platform features can increase lock-in. | Moderate. | Potentially higher if provider-specific Prisma features are used. |
| Sleep/cold-start behavior | Possible on low-cost tiers; validate. | Less severe for DB, but project limits apply. | Possible depending on plan. | Verify. |
| Staging DB deletion | Straightforward via provider UI/API. | Straightforward via project controls. | Straightforward. | Verify. |

## Preferred provider

Preferred: **Neon** for first research-public staging.

Reasoning:

- Clear separation between pooled runtime URL and direct migration URL.
- Good fit for Netlify/serverless connection patterns.
- Simple low-cost staging setup.
- Provider-neutral enough that app code does not need provider-specific changes.

Conditions:

- Confirm pooled runtime URL works with Prisma and app workload.
- Confirm direct migration URL is used only from controlled migration procedure.
- Confirm backup/export and deletion procedures before staging users are invited.

## Alternative provider

Alternative: **Supabase PostgreSQL**.

Reasoning:

- Mature hosted PostgreSQL option.
- Backup and operational tooling are familiar to many teams.
- Pooling is available, but Prisma compatibility and pooler mode must be verified.

Conditions:

- Confirm whether Prisma should use pooled or direct connection for runtime.
- Keep Supabase auth/storage features out of scope unless explicitly designed.
- Do not confuse Supabase project access with application RBAC.

## Not decided in this document

- No account is created.
- No database is created.
- No credential is generated.
- No provider-specific code is added.
- No migration is executed.

