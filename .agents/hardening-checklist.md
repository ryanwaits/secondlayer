# Hardening Checklist

## Tier A - Must Do Before Stacking New Tasks

- H1: CI lints docker scripts under nounset. Done - PR #35.
- H2: Continuous-service smoke harness. Done - commit a0bb763.
- H3: Post-deploy CI smoke check on /events, /index, /tip with auth variants. Pending.

## Tier B - Next Sprint

- Postgres error alerting
- block.timestamp=0 alerting
- L2 lag alerting
- Auto-rollback on smoke failure

## Tier C - Deferred

- Dual-write transition pattern
- Docker layer caching
- SSH detachment for long Docker builds
