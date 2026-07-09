# Architecture decision: research limited external MVP

Date: 2026-07-07

Decision status: proposed, not implemented.

## Current-state architecture summary

The current application is a Next.js 15 / TypeScript / Prisma application using the App Router and Route Handlers under `src/app/api`. Local research use currently relies on SQLite. PostgreSQL-specific Prisma schema, migrations, hardening SQL, role-separation SQL, and PostgreSQL integration tests already exist under `prisma/postgresql`.

The app includes:

- 96-well plate input and local research workflow.
- Prisma-backed sample, plate, well, breakpoint, MIC/SIR, image-review, audit, idempotency, and export records.
- OIDC Bearer-token API authentication with DB-backed user role and organization resolution.
- Development/local auth. During the audit, the working tree also contained an uncommitted research-public Basic Auth prototype; that prototype is not part of the approved Phase 1 architecture and must not be treated as an implemented security boundary.
- Excel export generated in memory through ExcelJS.
- Image upload/review routes that currently write preview images to `public/uploads/image-assessments` and call a separate FastAPI/OpenCV service through `IMAGE_ANALYSIS_URL`.

## Proposed Phase 1 architecture

Recommended Phase 1 target:

```text
Authorized research users
  -> Cloudflare Access
  -> Custom domain
  -> Netlify Next.js application
  -> External PostgreSQL, app-user credential only
```

Phase 1 should keep the scope intentionally small:

- Disable image analysis and persistent image upload.
- Use external PostgreSQL only; do not use SQLite in an internet-reachable runtime.
- Keep the app non-clinical and research-only.
- Use synthetic/anonymized data only.
- Prevent anonymous access.
- Keep migration credentials out of Netlify runtime.

## Authentication recommendation

Recommended option: **Cloudflare Access + application-side verification / fail-closed controls**.

| Option | Assessment |
| --- | --- |
| Cloudflare Access only | Not sufficient by itself unless direct Netlify URLs, deploy previews, and branch deploys are also protected or disabled. |
| Cloudflare Access + app-side verification | Preferred. It protects the custom-domain path and gives the app a backstop against direct-origin access. |
| Netlify-side protection only | Useful as an additional layer, but not enough to replace identity-aware access control. |
| Basic Auth only | Acceptable only as temporary defense-in-depth for a small research preview; not recommended as the primary internet-facing control. |

The app must not trust client-supplied role or organization claims. It should continue resolving role and organization from the database user record.

## Required design decisions before implementation

1. Whether the app will verify Cloudflare Access JWTs at the origin.
2. Whether Netlify direct URLs and deploy previews will be disabled, password-protected, or rejected by host allow-listing.
3. Which PostgreSQL provider and connection pooling mode will be used.
4. Whether migration execution is manual release procedure or protected CI workflow.
5. Which user is the initial research-public app user and what organization it belongs to.
6. Whether image routes are disabled entirely or return a controlled 404/503 while Phase 1 has image features off.

## Non-goals

- No clinical, diagnostic, regulated, or controlled production use.
- No anonymous public release.
- No persistent file upload or image storage in Phase 1.
- No Netlify deploy, Cloudflare config, DNS change, external DB creation, or secret registration in this audit.
