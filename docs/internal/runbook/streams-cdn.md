# Streams CDN (Cloudflare) runbook

How to put Cloudflare in front of the Streams read API so immutable, finalized
pages are served from the edge instead of the origin. No application code is
required — the API already emits the headers this relies on (Sprint 1). Caddy
(`docker/Caddyfile`) stays the origin and is unchanged.

## Why this is safe (and the one thing to get right)

Streams reads are **authenticated and per-tier** — every request carries a
`Bearer` token and resolves a `free/build/scale/enterprise` tenant, and each
response carries per-tenant `X-RateLimit-*` headers (see
`packages/api/src/streams/auth.ts`). This is **not** the open-beta
datasets/index model.

Consequences for caching:

- A shared cache that **ignores `Authorization`** would let one tenant's request
  serve cached bytes to another, bypassing auth and tier gating, and would pin
  one tenant's `X-RateLimit-*` headers onto everyone. **Do not do this.**
- The cache key **must include the bearer token** (hashed). This is a
  per-consumer edge cache: it still removes origin/Postgres load for a consumer
  that re-reads the same finalized pages (backfills, retries, restarts), which
  is the common case, without ever sharing a cached copy across tokens.

## What the origin already emits

- Finalized, immutable pages (`/v1/streams/events` with explicit
  `to_height ≤ finalized_height`, a finalized `/canonical/:height`, a finalized
  tx/block) →
  `Cache-Control: public, max-age=31536000, immutable` + a weak `ETag`.
- Everything that can still reorg (default/tip-spanning requests, `/tip`) →
  `Cache-Control: private, max-age=2`.

So an `immutable` response is the explicit, safe-to-cache signal; `private` is
the do-not-share signal. The edge only needs to honor what the origin says.

## Cloudflare configuration

1. **DNS / proxy**: proxy `api.secondlayer.tools` through Cloudflare (orange
   cloud). Origin remains Caddy → `api:3800`.
2. **Respect origin cache headers**: do not enable "Cache Everything." Use the
   default "Standard" caching so Cloudflare caches only responses with
   `Cache-Control: public` and never caches `private`. This makes `immutable`
   finalized pages cacheable and tip-spanning pages pass through.
3. **Cache key = URL + hashed bearer.** Add a Cache Rule (or Workers cache key)
   that includes a hash of the `Authorization` header in the cache key. Never
   serve a cached entry to a different token.
4. **Strip tenant headers from cached copies.** Ensure `X-RateLimit-*` and
   `Retry-After` are not served from cache. They are computed per request by the
   origin rate-limit middleware; with a per-token cache key and `private` on
   mutable responses they should not be cached, but verify (Transform Rule to
   remove them on cache hits if needed).
5. **Honor `ETag`/`If-None-Match`**: default Cloudflare behavior. Finalized
   pages revalidate cheaply (304) when the edge entry expires.

## Deep-reorg purge (rare)

A reorg deeper than the finality window would invalidate an already-`immutable`
page. On Stacks this requires a Bitcoin reorg past the burn-confirmation depth
and is extremely unlikely, but the recovery path must exist:

- The finalized `/canonical/:height` ETag is the `block_hash`, so a changed
  block changes its identity.
- If a deep reorg is ever confirmed, **purge by URL prefix** the affected
  `/v1/streams/events`, `/blocks/:height/events`, `/events/:tx_id`, and
  `/canonical/:height` entries for the rewound height range (Cloudflare cache
  purge by prefix/tag). The proper long-term fix is the reorg tombstone (Sprint
  7), after which orphaned rows are queryable rather than silently wrong.

## Verify

```
# Finalized, closed range → immutable, and a HIT on the second request (same token).
curl -sI -H "Authorization: Bearer $KEY" \
  "https://api.secondlayer.tools/v1/streams/events?from_height=<lo>&to_height=<hi≤finalized>" \
  | grep -i 'cache-control\|cf-cache-status\|etag'

# Default (tip-spanning) → private, never a shared HIT.
curl -sI -H "Authorization: Bearer $KEY" \
  "https://api.secondlayer.tools/v1/streams/events" \
  | grep -i 'cache-control\|cf-cache-status'
```

Expect `immutable` + `cf-cache-status: HIT` on the repeat finalized request, and
`private, max-age=2` with no shared HIT on the default request.
