# Threat model: research limited external preview

Date: 2026-07-07

Scope: `v0.3.0-research-public-preview`, internet-reachable but limited to authorized research users. This is not anonymous public access and not clinical/diagnostic/regulated/controlled production.

## BLOCKER

| Risk | Why it matters | Required mitigation before preview |
| --- | --- | --- |
| Direct Netlify origin bypass | Cloudflare Access on a custom domain does not automatically protect `*.netlify.app`, deploy previews, or branch deploys. | App-side Access JWT and host checks are implemented; real Netlify/Cloudflare staging must verify direct-origin denial. |
| Image upload route writes to local filesystem | Uploaded images are not durable serverless storage unless object storage is added. | Server-side image upload is disabled by default in research-public production. Phase 2 must add object storage/service auth before enabling. |
| SQLite allowed in external research mode | Any internet-reachable runtime must not use local filesystem SQLite or automatic fallback. | Research-public production now requires PostgreSQL app URL and rejects SQLite / migration credential fallback. |
| No Netlify deployment compatibility evidence | Next.js APIs, Prisma, and middleware need actual Netlify runtime verification. | Add a staging deployment test before any limited external preview. |

## HIGH

| Risk | Required mitigation |
| --- | --- |
| Basic Auth used as sole internet-facing control | Prefer Cloudflare Access. If Basic Auth remains, use it only as defense-in-depth with strong passwords and rate limiting upstream. |
| Middleware-only protection | Route Handlers must continue enforcing authentication/RBAC/organization checks. Page access also needs origin/access verification. |
| Preview deployment exposure | Disable or protect deploy previews and branch deploys. Do not assume only the custom domain is reachable. |
| Migration credential exposure | Keep `POSTGRES_PRISMA_DATABASE_URL` out of Netlify runtime. Use manual release procedure or protected CI only. |
| PostgreSQL connection exhaustion | Use pooled serverless PostgreSQL URLs or an approved pooler. Set conservative pool limits and monitor connection count. |
| Unrestricted file upload | Phase 1 should not accept uploads. Phase 2 requires object storage, content-type validation, size limits, malware-risk posture, and service auth. |

## MEDIUM

| Risk | Required mitigation |
| --- | --- |
| Excel export memory/timeout | Keep Phase 1 exports small, measure workbook sizes, and document limits. |
| Sample-ID sensitivity | Continue requiring synthetic/anonymized research IDs only. Warn that Sample-ID appears in research-local/preview exports. |
| Error messages/logging | Avoid logging credentials, full database URLs, uploaded file contents, or raw Excel content. |
| CORS/CSRF assumptions | Keep APIs same-origin, do not enable broad CORS, and review state-changing requests if cookie/session auth is introduced. |
| Rate limiting | Add upstream rate limiting via Cloudflare for login/API abuse scenarios. |
| Public `NEXT_PUBLIC_*` variables | Treat all `NEXT_PUBLIC_*` as browser-visible and never put secrets there. |

## LOW

| Risk | Required mitigation |
| --- | --- |
| Documentation drift between local and external research tracks | Keep `research-local` and `research-public` release documents separate. |
| Offline/PWA behavior in shared preview | Document that local browser storage is per-device and not a source of shared truth. |
| Image-review links visible when disabled | Hide disabled entry points or show a clear disabled message. |

## Explicit non-permitted mitigations

Do not recommend or perform:

- Disabling auth, RBAC, organization scope, triggers, append-only history, or BreakpointSet immutability.
- Manual database mutation of RawMic/SIR history.
- Storing real credentials, patient identifiers, or clinical data in repository docs.
- Treating this preview as clinical or controlled production.

