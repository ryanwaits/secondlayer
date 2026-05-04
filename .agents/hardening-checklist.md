# Hardening Checklist

## Tier A - Must Do Before Stacking New Tasks

- H1: CI lints docker scripts under nounset. Done - PR #35.
- H2: Continuous-service smoke harness. Done - commit a0bb763.
- H3: Post-deploy CI smoke check on /health, /public/status, /events, /index, /tip with auth variants. Done.

## Tier B - Next Sprint

- Postgres error alerting. Covered by scheduled staging health when `STAGING_STATUS_API_KEY` or `STAGING_DATABASE_URL` is configured.
- block.timestamp=0 alerting. Covered by scheduled staging health when `STAGING_DATABASE_URL` is configured.
- L2 lag alerting. Covered by scheduled staging health via `/public/status`.
- Auto-rollback on smoke failure

## Tier C - Deferred

- Dual-write transition pattern
- Docker layer caching
- SSH detachment for long Docker builds
