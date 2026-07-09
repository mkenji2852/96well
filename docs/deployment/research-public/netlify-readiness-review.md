# Netlify readiness review

Date: 2026-07-07

## Framework and routing inventory

| Area | Current state | Netlify assessment |
| --- | --- | --- |
| Next.js | `next` 15.5.9, React 19, App Router | Compatible with deployment testing and Netlify Next runtime validation. |
| UI routes | `src/app/page.tsx`, `src/app/review/image/page.tsx`, app layout | Compatible with changes. |
| API routes | Route Handlers under `src/app/api/**/route.ts` | Potentially compatible as Netlify Functions, but must be tested. |
| Runtime declarations | No explicit `runtime = "edge"` found | Node runtime is expected; this is appropriate for Prisma and ExcelJS. |
| Streaming/background jobs | No scheduled jobs or background workers found in the app routes | Compatible. |
| Runtime child process | No Node app route starts Python or child processes | Compatible. |
| Runtime filesystem writes | Image upload route writes to `public/uploads/image-assessments` | Not compatible for Phase 1. Disable image upload or move to object storage in Phase 2. |
| Separate image service | FastAPI/OpenCV service under `image-service` | External service required; not Netlify compatible directly. |
| Long-running work | Image analysis HTTP call has a 30s timeout; Excel generation can be memory/time sensitive | Image: Phase 2 external service. Excel: compatible for small exports with size limits. |

## API route classification

| Function group | Classification | Notes |
| --- | --- | --- |
| Samples / plates / wells | Compatible with changes | Requires external PostgreSQL, app-user runtime credential, and connection pooling review. |
| Breakpoint sets/rules | Compatible with changes | PostgreSQL hardening and app RBAC must remain enabled. |
| MIC/SIR result history | Compatible with changes | PostgreSQL partial unique indexes must be applied. |
| Excel export | Netlify compatible for small exports | Generated in memory, no persistent file required. Add response-size/timeout expectations. |
| Image assessment upload | External service required / disable for Phase 1 | Current route writes to local filesystem and calls FastAPI. |
| Image review pages | Compatible only when backed by stored image references | For Phase 1, hide/disable UI and prevent direct API writes. |
| Auth `/api/me` | Compatible with changes | Needs origin-bypass and Cloudflare Access integration decision. |

## Netlify-specific gaps

1. No `netlify.toml` or Netlify deployment profile has been validated.
2. Direct `*.netlify.app`, deploy preview, and branch deploy access paths are not yet designed.
3. The current Basic-auth middleware should not be relied on as the only entry protection; middleware/environment behavior must be verified in the Netlify build/runtime model.
4. Prisma in serverless can exhaust PostgreSQL connections without pooling.
5. Runtime image upload writes to `public/uploads`, which is not a safe persistent storage model on Netlify Functions.
6. The Phase 1 image-disabled mode must be enforced server-side, not only in UI.

## Required pre-preview validation

- Netlify build with `NODE_ENV=production`.
- Netlify Functions route smoke test.
- External PostgreSQL connection smoke test using app-user only.
- Cloudflare Access or equivalent identity-aware gate protecting the canonical domain.
- Direct Netlify origin access test.
- Deploy preview / branch deploy visibility test.
- Image-disabled E2E path.
- Excel export size and timeout sanity test.

