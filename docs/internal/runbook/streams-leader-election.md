# Runbook: indexer leader election + failover

Leader election lets you run **multiple indexer instances** safely. Every
instance serves HTTP (`/new_block` ingest, reads); only the elected **leader**
runs the singleton background loops (integrity/gap-backfill, tip follower, all
dataset/streams-bulk publishers, contract registry). Running those on more than
one instance would double-write.

Opt-in and **default off** — a single instance keeps today's behavior, so this
only matters when you scale the indexer horizontally.

## How it works

- Each instance with `INDEXER_LEADER_ELECTION=true` competes for one Postgres
  **advisory lock** (`INDEXER_LEADER_LOCK_KEY = 7702026`) held on a dedicated
  `max:1` connection (`packages/indexer/src/leader.ts`).
- **Acquire poll** every ~15s: `pg_try_advisory_lock`. The winner logs
  `Acquired leader lock` and starts the leader loops.
- **Heartbeat** every ~10s: the leader verifies it *still* holds the lock by
  counting advisory locks on its own backend (`pg_locks WHERE pid =
  pg_backend_pid()`), not a plain `SELECT 1`. A transparent driver reconnect
  starts a new session and silently drops the session-scoped lock; the heartbeat
  catches that within one beat and relinquishes (commit d7381920) so two
  instances can't both believe they're leader.
- **Failover**: when the leader exits (or loses the lock), its session closes and
  Postgres releases the advisory lock; a follower acquires it on its next poll
  (≤15s) and starts the loops.

## Enabling

Set on **every** indexer instance:

```
INDEXER_LEADER_ELECTION=true
```

All instances must share the same `DATABASE_URL` (the lock lives in that DB).
No other config changes; publisher/integrity `*_ENABLED` flags are unchanged and
still self-gate on top of leadership.

## Validating failover (staging)

Run two instances against one staging DB, then induce failover.

1. **Confirm a single leader.** Exactly one instance logs `Acquired leader lock`.
   Verify in the DB:

   ```sql
   SELECT pid, granted FROM pg_locks
   WHERE locktype = 'advisory' AND objid = 7702026;
   ```

   Expect exactly one granted row. Cross-check that only that instance logs the
   leader loops starting (tip follower / publishers).

2. **Kill the leader.** Stop the leader process/container (`docker stop`, SIGKILL,
   or `docker compose stop <leader>`).

3. **Assert clean handoff.** Within ~15s the surviving instance logs
   `Acquired leader lock` and starts the loops. The `pg_locks` query again shows
   exactly one granted row, now owned by the new leader's backend.

4. **Assert single-writer throughout.** At no point should both instances run the
   loops. Confirm no duplicate publisher output (e.g. the streams-bulk publisher
   shouldn't export the same range twice) and no gap/integrity double-runs.

5. **Reconnect drop (optional).** Force a DB connection reset (e.g. restart the
   pooler / bounce the network) and confirm the leader's heartbeat logs
   `Leader heartbeat failed; relinquishing` then re-elects — instead of two
   instances silently both acting as leader.

## Rollback

Set `INDEXER_LEADER_ELECTION` back to unset/false and run a single instance. With
one instance the loops run unconditionally (no lock), identical to pre-election
behavior.

## Related

- Bulk-dumps publisher finality + GA: `docs/runbook/streams-bulk-dumps-ga.md`
  (the publisher is a leader-only loop and uses the burn-confirmation boundary).
