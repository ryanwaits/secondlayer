# ADR 0001 - Phase 1 Reliability Closeout Gates

**Status:** Accepted
**Date:** May 4, 2026

## Context

Phase 1 closes on reliability evidence for the current single-server production path. Stacks Index FT/NFT decoded events can be sparse, so freshness lag alone can make the gate red even when the decoder is actively checkpointing and healthy. Production backup readiness also depends on daily logical backups and WAL sync not racing deploy maintenance.

## Decision

Staging Health gates FT/NFT decoders on their public decoder `status`. It still prints `lagSeconds` for operator visibility, but sparse-event lag does not fail the gate by itself.

Daily `pg_dump` and deploy migrations use one shared host DB maintenance lock. `backup-postgres.sh` writes to a temporary gzip, verifies it with `gzip -t`, atomically promotes it, and applies retention only after success. Deploy waits for the same lock before stopping DB writers, terminating stale sessions, and running migrations.

WAL archiving is enabled in the Hetzner compose override with `/wal_archive`, `archive_mode=on`, an idempotent `archive_command`, and `archive_timeout=300`.

## Consequences

- Decoder health reflects decoder activity rather than sparse FT/NFT event frequency.
- Public `/public/status` remains unchanged; the gate consumes existing fields differently.
- A deploy will wait instead of killing an active `pg_dump`.
- Enabling WAL archiving requires one controlled Postgres restart.
- Phase 1 can close only after production deploy, two consecutive green Staging Health runs, and fresh backup/WAL evidence.
