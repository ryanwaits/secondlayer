# Internal observer-events HTTP export

Compatible producer for SBA A1-shaped pulls (`after_height` + `after_index_block_hash`). Default off. Not a public `/v1` 1.0 envelope. Do not advertise as stable.

Default Labs producer remains SNP/Labs. This URL is a staging/compat pull so a Labs PR can point at an existing page shape instead of inventing one.

## Route

`GET /internal/observer-events` on the indexer process (default port 3700).

Not registered on the API container. Not under `/v1`.

## Env

| Variable | Role |
|---|---|
| `OBSERVER_HTTP_EXPORT=1` | Opt in. Any other value (or unset) leaves the route unregistered. |
| `OBSERVER_HTTP_EXPORT_TOKEN` | Shared secret. Required when bind is public. Sent as `Authorization: Bearer <token>`. |
| `INDEXER_HOST` / `HOST` | Declared bind host used only for the registration guard. Unset is treated as public `0.0.0.0`. Does not change `Bun.serve` hostname. |

## Registration guard

| `OBSERVER_HTTP_EXPORT` | Bind | Token | Route registered |
|---|---|---|---|
| unset / not `1` | any | any | no |
| `1` | loopback (`127.0.0.1`, `::1`, `localhost`) | optional | yes |
| `1` | public (`0.0.0.0`, empty, other) | unset / empty | **no** (error logged) |
| `1` | public | non-empty | yes (Bearer required) |

Misconfig does not register the route.

## Cursor

Querystring:

- `after_height` — integer block height from the payload
- `after_index_block_hash` — payload `index_block_hash`
- `limit` — default 100, clamped 1..1000
- `path` — optional; `/new_block` or `/new_burn_block`

Response:

```json
{
  "events": [ /* SbaObserverMessage */ ],
  "next": { "after_height": 123, "after_index_block_hash": "0x…" }
}
```

`next` is the last emitted message’s `block_height` + `index_block_hash`. Empty page, or a last message missing either field → `next: null`.

This is **not** the Streams cursor (`"height:event_index"`).

## vs `GET /v1/streams/events`

| | `/internal/observer-events` | `/v1/streams/events` |
|---|---|---|
| Surface | indexer, internal | public API |
| Body | raw observer POST payloads (`/new_block`, `/new_burn_block`) | decoded stream rows |
| Cursor | `after_height` + `after_index_block_hash` | `"height:event_index"` |
| Auth | loopback and/or Bearer token | Streams key / instance policy |
| Signature | unsigned (no `X-Signature`) | Streams `X-Signature` when signing key set |

## Signing

Unsigned. Streams `X-Signature` is not on this route. Token is the auth. Do not invent a second key.

## Example

```bash
OBSERVER_HTTP_EXPORT=1 INDEXER_HOST=127.0.0.1
```

```bash
curl -sS 'http://127.0.0.1:3700/internal/observer-events?limit=100'

curl -sS 'http://127.0.0.1:3700/internal/observer-events?after_height=100&after_index_block_hash=0xbbb222&limit=100'
```

With a token (required on a public bind):

```bash
curl -sS -H "Authorization: Bearer $OBSERVER_HTTP_EXPORT_TOKEN" \
  'http://127.0.0.1:3700/internal/observer-events?limit=100'
```
