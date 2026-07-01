# Research Local Runbook

## Purpose

This runbook describes how to use the 96well application as a local, research-only, non-clinical tool.

It is not a production deployment runbook. It does not authorize clinical use, diagnosis, treatment decisions, official laboratory reporting, or patient-identifying data handling.

## Scope

Allowed:

- local machine use;
- synthetic, anonymized, or research-only data;
- local SQLite development database;
- local development authentication;
- Excel export review and sharing after checking that no identifiers are included.

Not allowed under this runbook:

- production deployment;
- patient-identifying data;
- clinical result reporting;
- disabling authentication, RBAC, triggers, immutability, or append-only safeguards;
- using image analysis as a final decision without manual review.

## Preconditions

- Node.js and pnpm are available.
- The repository dependencies can be installed locally.
- `.env` is created from `.env.example`.
- Local data is synthetic, anonymized, or research-only.
- The operator understands that this is not a clinical or regulated production release.

## Environment

Use local development settings:

```dotenv
DATABASE_URL="file:./dev.db"
DEV_AUTH_ENABLED="true"
DEV_AUTH_USER_ID="dev-admin"
NEXT_PUBLIC_IMAGE_REVIEW_ENABLED="true"
```

Do not set `NODE_ENV=production` for research-local use unless completing the separate controlled production deployment process.

Do not put real credentials, patient identifiers, or production URLs into local environment files.

## Local setup

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:migrate
pnpm db:seed
```

If local Prisma migration is unavailable:

```powershell
pnpm db:init
pnpm db:seed
```

## Verification

Run:

```powershell
pnpm lint
pnpm test
pnpm build
```

Optional browser check:

```powershell
pnpm dev
```

Open:

```text
http://127.0.0.1:3000
```

Expected result:

- top page opens;
- sample and plate entry can be used with research data;
- save works locally;
- Excel export defaults to anonymized output;
- image review, if used, remains manual-review based.

## Data handling

- Use synthetic or anonymized sample codes.
- Keep notes free of patient identifiers.
- Do not upload images containing labels or identifiers.
- Review Excel output before sharing.
- Prefer `ANONYMIZED` export for any external sharing.
- If a file contains identifiers by mistake, do not share it; delete it according to local research data handling policy.

## Release decision for this runbook

The current release is:

```text
CONDITIONAL GO for research-only local non-clinical use.
NO-GO for clinical, diagnostic, regulated, or controlled production use.
```

## When to stop

Stop using this local release and return to the controlled production deployment process if:

- patient-identifying data will be used;
- clinical or diagnostic decisions will be made;
- data will be stored on shared infrastructure;
- multiple organizations or facilities will use the same deployment;
- production OIDC/PostgreSQL/DB role controls are required;
- audit or regulatory evidence is required.

