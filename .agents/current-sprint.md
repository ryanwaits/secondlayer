# Sprint 2 - Week 2

## Status

- Started: 2026-05-03
- Target completion: 2026-05-17

## Goal

Complete the Stacks Index MVP: decoded_events schema, ft-transfers and nft-transfers endpoints, SDK methods, and docs page.

## Completed

- Task 1 - Stacks Index schema + PRD 0002 + migration 0066 (PR #25)
- Task 2 - /v1/index/ft-transfers + continuous l2-decoder + SDK list (PR #28, hotfixes #30-#34)
- H1 - CI lints docker scripts under nounset (PR #35)
- H2 - Continuous-service smoke harness (commit a0bb763)
- H3 - Post-deploy CI smoke check on /events, /index, /tip with auth variants (this work)
- Task 3 - /v1/index/nft-transfers (this work)
- Sprint-zero - Agent operating harness (commits 40caa47, 5d3835e, 6ded35b, 39ab645)

## Pending

- Task 4 - SDK async iterator + nft methods
- Task 5 - Stacks Index docs page + status tiles

## Locked Decisions For This Sprint

ADR-0001 through ADR-0017. See `.agents/DECISIONS.md`.

## Tech Debt Accepted Into Next Sprint

- Runtime tokens store (avoid API redeploy on key change)
- Post-deploy CI smoke check across all services (H3 covers partial)
- Detach Docker build from SSH session
- Layer-cache Docker builds
- Migration safety doc / dual-write pattern
- Staging health monitoring (block.timestamp=0, postgres errors, decoder lag)
- consumeStreamsEvents bounded-mode option
- streamStreamsEvents iterator maxPages / maxEmptyPolls
- STREAMS_BLOCKS_PER_DAY post-Nakamoto correction
- Document sk-sl_streams_status_public is non-secret in SDK README
- Standardize missing-env-var defaults pattern
