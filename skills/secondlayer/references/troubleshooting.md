# Troubleshooting

When the user says "it's not working", start here. Always inspect before mutating.

## Subgraph: behind, stalled, or in error

```bash
sl subgraphs status <name>          # human-readable
sl subgraphs status <name> --json   # machine-readable
sl subgraphs list --json            # all subgraphs at once
sl subgraphs gaps <name>            # specific missing block ranges
```

Look at:
- `status` — `synced`, `catching_up`, `reindexing`, `backfilling`, `error`.
- `last_processed_block` vs current chain tip.
- `error_count` + `last_error` message.
- Reported gaps (missing ranges that didn't process the first time).

**Common causes:**

| Symptom | Likely cause | Action |
|---|---|---|
| Stuck on `catching_up` for hours | Normal — first deploy from low `startBlock` | Wait; or redeploy with `--start-block <near tip>` to skip history. |
| `error` status with handler exception | Bug in handler — bad type, missing field, missing `uniqueKeys` | Read `last_error`; fix handler; redeploy. 50+ consecutive errors flips status to `error`. |
| Gaps after live tip caught up | Transient ingestion failure on specific ranges | `sl subgraphs backfill <name> --from <gap_start> --to <gap_end>`. |
| Schema mismatch error on deploy | Table/column changed in a breaking way | Deploy will auto-trigger reindex; confirm before allowing (drops the table). |
| `upsert requires unique key` error | Schema declared `upsert` but missing `uniqueKeys` | Add `uniqueKeys: [["col_a"]]` to the table. |

## Subgraph: source code drift between local file and deployed version

```bash
# From CLI: read the source bundled when deployed
sl subgraphs spec <name> --format markdown    # at minimum shows current schema
# From SDK: sl.subgraphs.getSource(name)
```

Compare the deployed bundle to your local file. If you don't have the local file anymore, use the SDK's `getSource` to recover the canonical version.

## Subscription: paused or failing

```bash
sl subscriptions get <name>
sl subscriptions doctor <name>      # all-in-one diagnosis
sl subscriptions deliveries <name>  # last ~100 attempts
sl subscriptions dead <name>        # exhausted retries
```

`doctor` checks: subscription status + circuit breaker state, recent delivery successes/failures, dead-letter count, linked subgraph status + gaps. Outputs next-step hints.

**Common causes:**

| Symptom | Cause | Action |
|---|---|---|
| Subscription `paused` after deploy | 20 consecutive failures auto-paused it | Fix receiver → `sl subscriptions resume <name>`. |
| All deliveries return 401 | Signature mismatch — wrong/outdated secret | Re-verify your secret. If rotated, deliveries with old secret 401. |
| Receiver getting nothing | Filter too narrow OR linked subgraph not synced | Check `sl subgraphs status <linked>`. Try widening or removing the filter temporarily. |
| Receiver timing out | Doing work synchronously in the handler | Return 2xx immediately; queue the work. Retries fire 30s → 2m → 10m → 1h → 6h → 24h → 72h. |
| Verification fails for all requests | Verifying re-stringified JSON, not raw body | Use the raw request body bytes/string for HMAC, not `JSON.stringify(req.body)`. |

## Subscription: signature verification

Use `verifyWebhookSignature(rawBody, headers, secret)` from `@secondlayer/sdk`. It reads the Standard Webhooks headers (`webhook-id` / `webhook-timestamp` / `webhook-signature`) from the request headers object and HMAC-verifies a `v1` signature. The most common failure mode is passing `JSON.stringify(req.body)` instead of the raw body — the framework's parsed JSON loses key ordering and whitespace, breaking the HMAC. Always grab the raw body bytes before any JSON parser touches it.

If you're verifying from a non-TS language, see `references/api-rest.md` "Webhook verification" for a Python reference implementation.

## Subscription: replays and dead letters

**Before replaying:** confirm exact block range with the user and verify delivery health. Replays drain at reduced capacity (10% of live throughput) to keep live delivery responsive — but a large replay still adds load.

```bash
# Requeue one specific dead row after fixing receiver
sl subscriptions dead <name>
sl subscriptions requeue <name> <outbox-id>

# Replay a historical range (max 100k blocks)
sl subscriptions replay <name> --from-block 180000 --to-block 181000
```

**Don't replay** until: you've inspected `deliveries` to confirm what failed, you've fixed the receiver, and the user has confirmed the exact block range.

## Streams: connection or auth issues

```bash
sl streams tip                      # baseline reachability
```

| Symptom | Cause | Action |
|---|---|---|
| `401 Unauthorized` | Missing `SL_STREAMS_API_KEY` | Export it; or pass via `createStreamsClient({ apiKey })`. |
| `429 Too Many Requests` | Hit rate limit | SDK throws `RateLimitError` with `retryAfter`. Back off; use `events.consume` instead of polling `events.list`. |
| Consumer stops processing | Aborted by signal OR `mode: "bounded"` reached end | Restart with last saved cursor. |
| `next_cursor: null` reached | Caught up to tip (with `mode: "bounded"`) | Switch to `mode: "tail"` to keep polling. |

## SDK: catching errors correctly

```ts
import { ApiError, VersionConflictError } from "@secondlayer/sdk";
import {
  AuthError,
  RateLimitError,
  StreamsServerError,
  ValidationError,
} from "@secondlayer/sdk/streams";

try {
  await sl.subgraphs.deploy(input);
} catch (err) {
  if (err instanceof VersionConflictError) {
    console.error(err.currentVersion, err.expectedVersion);
  } else if (err instanceof ApiError) {
    console.error(err.status, err.code, err.message, err.body);
  }
}
```

The Streams errors do **not** extend `ApiError` — check them separately when wrapping Streams calls.

## CLI: session expired / project not selected / instance suspended

CLI returns typed errors with action hints:

| Error code | Hint |
|---|---|
| `SESSION_EXPIRED` | `sl login` |
| `NO_ACTIVE_PROJECT` | `sl project use <slug>` |
| `NO_TENANT_FOR_PROJECT` | `sl instance create --plan launch` (dedicated only) |
| `TENANT_SUSPENDED` | Contact billing / `sl instance resume` |
| `KEY_ROTATED` | Handled transparently (CLI re-mints + retries once) |

## Stacks SDK: contract calls failing

| Symptom | Cause | Action |
|---|---|---|
| `ContractResponseError` on `getContract` read | Contract returned `(err ...)` | Caller threw — wrap in try/catch. The error carries the unwrapped `(err ...)` value. |
| `BroadcastError: bad nonce` | Stale nonce | Don't hard-code `nonce`; let the SDK fetch it. If you must, refetch with `getNonce`. |
| Post-condition rejected the tx | Asserted movements don't match actual | Read the contract; trace asset flows; adjust `Pc.*` calls to cover them all. Or use `postConditionMode: "allow"` for testing only. |
| `SimulationError` from `simulateCall` | Contract reverted in simulation | Inspect the returned error; usually a Clarity assertion `(err uXX)`. |

## Things that look like bugs but aren't

- **`webhook-timestamp` is dispatch time, not row creation time.** Standard Webhooks spec requires the timestamp to be within the tolerance window when signed; if Secondlayer signed at row creation and the row sat in the outbox for hours, every retry would fail verification. Stamping at dispatch and using `webhook-id` for dedup is correct.
- **Schema additions don't reindex; schema removals/type changes do.** Add a column → ALTER TABLE, no reindex. Drop a column → drop + reindex. Confirm before approving.
- **`startBlock` is honored only on first deploy** — once a subgraph has indexed past it, subsequent deploys ignore it. Use `--start-block` to override at deploy time (resets the position).
