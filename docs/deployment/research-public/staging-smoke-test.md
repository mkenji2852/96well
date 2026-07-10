# Staging smoke test: research-public preview

Date: 2026-07-10

Purpose: verify a real staging deployment before sharing access with limited research users. This test must use synthetic/anonymized non-clinical data only.

## Preconditions

- CI evidence is complete.
- External PostgreSQL staging migration completed.
- Runtime uses application DB credential only.
- Cloudflare Access configured on the custom staging hostname.
- App-side Cloudflare Access JWT verification configured.
- Existing application authentication / OIDC / DB user mapping configured.
- Image upload and analysis disabled.
- Backup/cleanup plan ready.

## Test sequence

1. Anonymous access rejection
   - Open the custom staging hostname without an Access session.
   - Expected: access is denied before app use.

2. Invalid Access JWT rejection
   - Send a request with missing, malformed, expired, wrong issuer, or wrong audience Access token.
   - Expected: request is rejected and does not reach authenticated app behavior.

3. Valid Access user reaches app shell
   - Authenticate through Cloudflare Access as an allowed research user.
   - Expected: app shell loads.

4. Existing application authentication
   - Confirm `/api/me` resolves the authenticated DB `User`.
   - Expected: role and organization are DB-backed, not token-claim-backed.
   - If the browser cannot provide the required OIDC Bearer token, stop: this is an auth UX blocker.

5. Direct Netlify origin behavior
   - Try the Netlify direct deploy URL, deploy preview URL, and branch deploy URL if present.
   - Expected: no anonymous app/API access. Missing Access JWT or disallowed host is rejected.

6. API direct access without Access JWT
   - Call `/api/me` and a representative write API directly without the Access JWT.
   - Expected: rejected.

7. SQLite runtime path absent
   - Confirm runtime config uses `POSTGRES_APP_DATABASE_URL`.
   - Expected: no SQLite `DATABASE_URL` runtime path.

8. PostgreSQL connection
   - Create or look up a synthetic/anonymized sample.
   - Expected: successful DB read/write through app runtime credential.

9. Sample and plate workflow
   - Create or open a synthetic/anonymized Sample-ID.
   - Select/create a plate configuration.
   - Save a 96-well plate.
   - Expected: save succeeds and data reloads.

10. Existing sample/plate reload
    - Reload the page or open the same sample/plate again.
    - Expected: persisted staging PostgreSQL data is shown.

11. Excel export
    - Export using ANONYMIZED profile or research-preview equivalent.
    - Expected: workbook opens, does not contain patient identifiers or real clinical data, and formula injection protections remain effective.

12. Image UI disabled
    - Confirm image upload/review entry points are hidden or clearly disabled.
    - Expected: no active upload path for Phase 1.

13. Image upload API disabled
    - Attempt a multipart upload to the image assessment API.
    - Expected: controlled disabled response; no FastAPI request and no filesystem persistence assumption.

14. No local filesystem persistence assumption
    - Confirm the staging workflow does not require local `public/uploads`, SQLite files, or other durable local files.

15. Logs and errors
    - Review deploy/app logs.
    - Expected: no credentials, full DB URLs, Access JWTs, OIDC tokens, patient identifiers, Excel contents, or uploaded image contents.

16. Access session expiry/logout
    - Expire or revoke the Access session if feasible.
    - Expected: subsequent access requires re-authentication and API calls fail closed.

17. Backup availability
    - Confirm provider backup or export mechanism exists for staging.
    - Expected: restore/cleanup plan can be executed if staging validation fails.

## GO / NO-GO

- GO to limited research preview only if every required smoke test passes and evidence is recorded.
- CONDITIONAL GO only for internal staging iteration with documented blockers and no external preview sharing.
- NO-GO for anonymous public use.
- NO-GO for clinical, diagnostic, regulated, or controlled production use.

