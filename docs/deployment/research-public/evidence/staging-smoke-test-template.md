# Research-public staging smoke test evidence template

Date completed: `<YYYY-MM-DD>`

Do not record secrets, real database URLs, Access JWTs, OIDC tokens, patient identifiers, clinical data, or private deployment URLs unless your evidence storage policy explicitly permits it.

## Metadata

- Verifier:
- Commit SHA:
- Pull request:
- GitHub Actions run URL:
- Staging deployment reference:
- Custom staging domain reference:
- PostgreSQL provider:
- Region:
- Smoke test decision: `GO | CONDITIONAL GO | NO-GO`

## Access boundary

- Anonymous access rejected:
- Invalid/missing Access JWT rejected:
- Valid Access user reaches app shell:
- Direct Netlify origin rejected or protected:
- Deploy preview / branch deploy rejected or protected:
- Direct API request without Access JWT rejected:

## Application authentication

- `/api/me` resolves authenticated DB user:
- Role from DB:
- Organization from DB:
- Other-organization object returns `404`:
- Auth UX blocker observed:

## Runtime/database

- SQLite runtime absent:
- Runtime uses app DB credential:
- Migration credential absent from runtime:
- PostgreSQL read/write smoke test:
- App user DDL forbidden:

## Functional smoke test

- Synthetic/anonymized Sample-ID used:
- Sample created or opened:
- Plate created or opened:
- 96-well plate saved:
- Existing sample/plate reloaded:
- Excel ANONYMIZED export generated:
- Export reviewed for no patient identifiers:

## Image-disabled checks

- Image UI disabled or clearly blocked:
- Image upload API rejected:
- FastAPI/image service not called:
- No local filesystem persistence required:

## Logging and cleanup readiness

- Logs reviewed for secrets:
- Logs reviewed for patient/clinical data:
- Backup/export availability confirmed:
- Rollback/cleanup procedure ready:

## Decision

- GO / CONDITIONAL GO / NO-GO:
- Blocking findings:
- Follow-up owner:
- Timestamp:

