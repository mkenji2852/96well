# Rollback and cleanup: research-public staging

Date: 2026-07-10

Purpose: define safe cleanup actions if research-public staging deployment, access control, database migration, or smoke testing fails. This document is for staging only and does not authorize manual mutation of clinical-style data histories.

## Rollback decision criteria

Stop staging validation and begin containment if any of the following occur:

- anonymous access succeeds;
- direct Netlify origin bypass succeeds;
- API direct access bypasses Cloudflare Access or app auth;
- runtime uses SQLite;
- migration credential is present in Netlify runtime;
- image upload or analysis is active in Phase 1;
- app auth/RBAC/organization scope fails;
- secrets appear in logs;
- staging DB integrity check fails.

## Immediate containment

1. Stop sharing the staging link.
2. Disable or restrict the Netlify deployment.
3. Disable or tighten Cloudflare Access policy.
4. Rotate/revoke exposed or suspected credentials.
5. Preserve logs and evidence for diagnosis.

Do not bypass auth, RBAC, triggers, append-only history, or BreakpointSet immutability to make staging appear healthy.

## Application rollback

1. Re-deploy the last known safe commit or disable the staging deploy.
2. Confirm no preview/branch deploy remains publicly reachable.
3. Confirm custom staging domain does not route to an unsafe deployment.

## Database cleanup

1. Revoke the application runtime credential if access boundary failed.
2. Revoke the migration credential if it was exposed or used from runtime.
3. Drop or archive the staging database only after explicit approval.
4. Preserve migration logs and smoke-test evidence.
5. Do not manually mutate RawMic/SIR append-only history.

## Cloudflare Access cleanup

1. Disable the staging Access application or remove allowed users.
2. Remove or rotate the Access application AUD if compromised.
3. Verify direct-origin Netlify URLs remain protected or inaccessible.

## DNS and Netlify cleanup

1. Remove custom staging domain mapping if needed.
2. Remove Netlify environment variables.
3. Disable deploy previews/branch deploys or ensure they are Access-protected.
4. Delete temporary staging deployment only after evidence has been retained.

## Post-cleanup verification

- [ ] Staging hostname no longer exposes the app.
- [ ] Direct Netlify URLs no longer expose the app anonymously.
- [ ] DB credentials revoked or rotated.
- [ ] Cloudflare Access policy disabled or corrected.
- [ ] Incident/evidence record completed.

