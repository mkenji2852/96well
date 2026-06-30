# Deployment documentation

This directory contains operational documents for controlled production deployment of the 96well antimicrobial susceptibility testing application.

## Documents

- [Production Deployment Runbook](./production-deployment-runbook.md)
- [Rollback Runbook](./rollback-runbook.md)
- [Pre-production Checklist](./pre-production-checklist.md)
- [Production Smoke Test](./production-smoke-test.md)
- [Environment Variables](./environment-variables.md)
- [Production Evidence Template](./production-evidence-template.md)
- [Production Environment Template](../../.env.production.example)

## How to use these documents

1. Review the release readiness record for the target release.
2. Complete the [Pre-production Checklist](./pre-production-checklist.md).
3. Follow the [Production Deployment Runbook](./production-deployment-runbook.md) during the approved deployment window.
4. Confirm environment-variable requirements with [Environment Variables](./environment-variables.md) and the placeholder-only [Production Environment Template](../../.env.production.example).
5. Run the [Production Smoke Test](./production-smoke-test.md) after deployment.
6. Record manual verification results with the [Production Evidence Template](./production-evidence-template.md).
7. Keep the [Rollback Runbook](./rollback-runbook.md) available for incident response.
8. Store completed evidence in the approved release or compliance evidence system.

These documents must not contain real credentials, secret values, or production-only URLs.

## Related release readiness records

- [2026-06-30 Release Readiness](../release/2026-06-30-release-readiness.md)
