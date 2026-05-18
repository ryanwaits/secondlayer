# REST API

The Secondlayer platform API is the source of truth that the SDK and CLI sit on top of. Use it directly from non-TypeScript clients (curl, Python, Go), webhooks-only setups, or anywhere you can't run the SDK.

> If you're in TypeScript, prefer `@secondlayer/sdk` — it handles cursors, retries, typed responses. See `references/sdk.md`.

## Base URL

```
https://api.secondlayer.tools
```

Override with `SL_API_URL` env var or `baseUrl` SDK option.

## Authentication

| Endpoint family | Auth required for reads? | Auth required for writes? | Header |
|---|---|---|---|
| `/v1/streams/*` | **Yes** (Streams API key) | n/a (read-only) | `Authorization: Bearer <SL_STREAMS_API_KEY>` |
| `/v1/index/*` | No (open beta) | n/a (read-only) | `Authorization: Bearer <key>` if you have one |
| `/api/subgraphs/*` | No (open beta) | Yes | `Authorization: Bearer <apiKey>` |
| `/api/subscriptions/*` | Yes | Yes | `Authorization: Bearer <apiKey>` |

API key formats:
- `sk-sl_*` — service / API key (long-lived, from dashboard)
- Session JWT — short-lived, from `sl login` (CLI auto-mints 5-minute ephemeral tenant JWTs per call)

## Response envelopes

Paginated reads return an envelope, never a bare array:

```json
{
  "events": [ ... ],
  "next_cursor": "7970329:8",
  "tip": { "block_height": 7970800, "lag_seconds": 12 },
  "reorgs": []
}
```

Cursors are opaque strings of the form `<block_height>:<event_index>`. **Do not parse them.** Pass `next_cursor` back as `cursor` to fetch the next page. `null` means end of stream.

Errors use HTTP status + a JSON body:

```json
{ "error": "NOT_FOUND", "message": "Subgraph not found" }
```

Common error codes: `NOT_FOUND`, `UNAUTHORIZED`, `VALIDATION_ERROR`, `VERSION_CONFLICT`, `RATE_LIMITED`, `SESSION_EXPIRED`, `TENANT_SUSPENDED`.

---

## `/v1/streams` — raw L1 events

### `GET /v1/streams/tip`

Returns current canonical tip.

```bash
curl -H "Authorization: Bearer $SL_STREAMS_API_KEY" \
  https://api.secondlayer.tools/v1/streams/tip
```

Response: `{ block_height, block_hash, burn_block_height, lag_seconds }`.

### `GET /v1/streams/events`

Cursor-paginated firehose of decoded events.

| Query param | Type | Description |
|---|---|---|
| `cursor` | string | Resume from this cursor (exclusive). |
| `fromHeight` | number | Block height ≥ |
| `toHeight` | number | Block height ≤ |
| `types` | comma-separated | `stx_transfer`, `stx_mint`, `stx_burn`, `stx_lock`, `ft_transfer`, `ft_mint`, `ft_burn`, `nft_transfer`, `nft_mint`, `nft_burn`, `print` |
| `contractId` | string | Filter to one contract |
| `limit` | number | 1-1000, default 100 |

```bash
curl -H "Authorization: Bearer $SL_STREAMS_API_KEY" \
  "https://api.secondlayer.tools/v1/streams/events?types=ft_transfer&limit=50"
```

### `GET /v1/streams/events/{txId}`

All events for one transaction.

### `GET /v1/streams/blocks/{heightOrHash}/events`

All events in one block.

### `GET /v1/streams/canonical/{height}`

Canonical block info at height. 404 if not canonical.

### `GET /v1/streams/reorgs`

Recent chain reorgs.

| Query param | Type | Description |
|---|---|---|
| `since` | ISO 8601 | Required. Reorgs detected after this timestamp. |
| `limit` | number | Page size |

---

## `/v1/index` — decoded L2 transfers

Pre-decoded SIP-010 (FT) and SIP-009 (NFT) transfers. Faster than `/v1/streams` when you only need transfers; filtered by principal/contract.

### `GET /v1/index/ft-transfers`

| Query param | Type | Description |
|---|---|---|
| `cursor` | string | Resume token |
| `contractId` | string | Token contract |
| `sender` | string | Stacks principal |
| `recipient` | string | Stacks principal |
| `fromHeight` | number | |
| `toHeight` | number | |
| `limit` | number | Default 200, max 1000 |

```bash
curl "https://api.secondlayer.tools/v1/index/ft-transfers?recipient=SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7&limit=20"
```

### `GET /v1/index/nft-transfers`

| Query param | Type | Description |
|---|---|---|
| `cursor` | string | Resume token |
| `contractId` | string | NFT contract |
| `assetIdentifier` | string | Full asset id (`SP....contract::token-name`) |
| `sender` | string | |
| `recipient` | string | |
| `fromHeight` | number | |
| `toHeight` | number | |
| `limit` | number | |

---

## `/api/subgraphs` — subgraph management

### `GET /api/subgraphs`

List deployed subgraphs (project-scoped).

### `GET /api/subgraphs/{name}`

Full metadata, schema, status, gaps, row counts.

### `GET /api/subgraphs/{name}/{table}`

Query rows. Schema-aware filters.

| Query param | Type | Description |
|---|---|---|
| `_sort` | string | Column name |
| `_order` | `asc`\|`desc` | |
| `_limit` | number | Default 200, max 1000 |
| `_offset` | number | |
| `_fields` | comma-separated | Columns to return |
| `<column>` | scalar | Equality filter |
| `<column>.gte` / `.lte` / `.gt` / `.lt` / `.neq` | scalar | Comparison filter |

```bash
curl "https://api.secondlayer.tools/api/subgraphs/stx-transfers/transfers?_sort=_block_height&_order=desc&_limit=10&amount.gte=1000000"
```

### `GET /api/subgraphs/{name}/{table}/count`

Returns `{ count: number }` applying the same filter params (sans `_sort` / `_limit`).

### `GET /api/subgraphs/{name}/openapi.json`
### `GET /api/subgraphs/{name}/schema.json`
### `GET /api/subgraphs/{name}/docs.md`

Auto-generated docs in three formats. Optional `?server=<url>` overrides the server URL.

### `POST /api/subgraphs` *(auth)*

Deploy / update a subgraph. Body contains bundled handler code + definition.

### `POST /api/subgraphs/{name}/reindex` *(auth)*

Body: `{ fromBlock?, toBlock? }`. **Destructive** — drops + reprocesses.

### `POST /api/subgraphs/{name}/backfill` *(auth)*

Body: `{ fromBlock, toBlock }` (both required). Additive — fills a gap without dropping.

### `POST /api/subgraphs/{name}/stop` *(auth)*

Cancel a running reindex/backfill.

### `GET /api/subgraphs/{name}/gaps`

| Query param | Type | Description |
|---|---|---|
| `_limit` | number | Default 50 |
| `_offset` | number | |
| `resolved` | boolean | Include resolved gaps |

### `DELETE /api/subgraphs/{name}` *(auth)*

Body: `?force=true` to cancel active ops first.

### `GET /api/subgraphs/{name}/source`

Returns bundled source code, version, deployment metadata. Useful for re-generating typed clients.

---

## `/api/subscriptions` — webhook subscriptions *(auth)*

### `GET /api/subscriptions`

List subscriptions for the active tenant.

### `GET /api/subscriptions/{id}`

`{id}` accepts either the UUID or the subscription's `name`.

### `POST /api/subscriptions`

Create. Body:

```json
{
  "name": "whale-alerts",
  "subgraphName": "stx-transfers",
  "tableName": "transfers",
  "url": "https://my-app.com/webhook",
  "format": "standard-webhooks",
  "runtime": "node",
  "filter": { "amount": { "gte": "1000000000" } },
  "authConfig": { "authType": "bearer", "token": "secret-token" }
}
```

Response includes a one-time `signingSecret`:

```json
{
  "subscription": { ... },
  "signingSecret": "whsec_..."
}
```

**Store the signing secret immediately** — it's never returned again. Use it to verify webhook signatures (see [Webhook verification](#webhook-verification)).

**Format options:** `standard-webhooks` (default), `inngest`, `trigger`, `cloudflare`, `cloudevents`, `raw`.

**Runtime options:** `inngest`, `trigger`, `cloudflare`, `node`. Determines payload framing for the receiver.

### `PATCH /api/subscriptions/{id}`

Update any of: `name`, `url`, `filter`, `format`, `runtime`, `authConfig`, `maxRetries`, `timeoutMs`, `concurrency`.

### `POST /api/subscriptions/{id}/pause`
### `POST /api/subscriptions/{id}/resume`

### `POST /api/subscriptions/{id}/rotate-secret`

Returns new `signingSecret` (one-time). **Existing receivers using the old secret will reject deliveries** until updated.

### `GET /api/subscriptions/{id}/deliveries`

Last ~100 delivery attempts with status, duration, response preview.

### `GET /api/subscriptions/{id}/dead`

Dead-letter rows (failed all retries).

### `POST /api/subscriptions/{id}/replay`

Body: `{ fromBlock: number, toBlock: number }`. Requeues historical rows. Max 100k blocks.

### `POST /api/subscriptions/{id}/dead/{outboxId}/requeue`

Requeue a single dead-letter row.

### `DELETE /api/subscriptions/{id}`

Delete subscription and any pending outbox rows.

---

## Webhook verification

The default `format: "standard-webhooks"` sends three headers:

| Header | Purpose |
|---|---|
| `webhook-id` | UUID for this delivery — stable across retries (use as your dedup key) |
| `webhook-timestamp` | Unix seconds at dispatch |
| `webhook-signature` | Space-separated `v1,<base64-hmac>` tuples |

The signed payload is `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC-SHA256 with the signing secret (base64-decoded after stripping the `whsec_` prefix), output base64. Verify in any language:

```python
# Python
import hmac, hashlib, base64, time

def verify(raw_body: str, webhook_id: str, webhook_timestamp: str,
           webhook_signature: str, signing_secret: str,
           tolerance_seconds: int = 300) -> bool:
    if abs(time.time() - int(webhook_timestamp)) > tolerance_seconds:
        return False
    key = base64.b64decode(signing_secret.removeprefix("whsec_"))
    signed = f"{webhook_id}.{webhook_timestamp}.{raw_body}".encode()
    expected = base64.b64encode(
        hmac.new(key, signed, hashlib.sha256).digest()
    ).decode()
    # `webhook-signature` can carry multiple versions: "v1,abc v1a,def"
    return any(
        hmac.compare_digest(part.split(",", 1)[1], expected)
        for part in webhook_signature.split(" ")
        if part.startswith("v1,")
    )
```

Reject any request whose `webhook-timestamp` is more than 5 minutes from now — replay protection.

> **TypeScript shortcut.** `@secondlayer/sdk` exports `verifyWebhookSignature(rawBody, headers, secret)` which does this verification for you — pass the raw body and the request headers object (Node, Fetch `Headers`, or a lookup function all work). See `references/sdk.md` for usage.

---

## Delivery retry schedule

Failed deliveries retry on this schedule:

```
30s → 2m → 10m → 1h → 6h → 24h → 72h
```

After 20 consecutive failures the subscription is auto-paused (circuit breaker). Use `POST /api/subscriptions/{id}/resume` to re-enable, but fix the receiver first.

Exhausted rows land in `/dead` and can be requeued individually.

---

## Rate limits

Open-beta default: generous but not unmetered. The SDK throws `RateLimitError` (status 429) with a `retryAfter` header. Back off and retry.

For sustained high-throughput streaming, prefer `events.consume` / `events.stream` from the SDK — they checkpoint and batch automatically.
