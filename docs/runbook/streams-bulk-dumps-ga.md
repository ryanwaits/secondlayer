# Streams bulk dumps — GA runbook

How to take the bulk parquet dump publisher from staging to GA. The pipeline is
feature-complete (`packages/indexer/src/streams-bulk/`); GA is an ops flip plus
publishing the public base URL. Client tooling already exists:
`client.dumps.*` and `client.events.replay()` (SDK), `sl streams pull` (CLI).

## 1. Provision R2 (or S3-compatible) storage

Create a bucket and a credential scoped to it. The publisher writes parquet +
manifest objects under the prefix `stacks-streams/mainnet/v0/` (see
`packages/indexer/src/streams-bulk/paths.ts`).

## 2. Set prod indexer env

| Variable | Purpose |
|---|---|
| `STREAMS_BULK_PUBLISHER_ENABLED` | `true` to start the publisher loop |
| `STREAMS_BULK_R2_ENDPOINT` | R2/S3 endpoint URL |
| `STREAMS_BULK_R2_ACCESS_KEY_ID` | credential |
| `STREAMS_BULK_R2_SECRET_ACCESS_KEY` | credential |
| `STREAMS_BULK_R2_BUCKET` | bucket name |
| `STREAMS_BULK_PUBLIC_BASE_URL` | public read base for the bucket (CDN/R2 public URL) — what the API + clients resolve dumps against |
| `STREAMS_BULK_PUBLISHER_INTERVAL_MS` | optional, publish cadence (default 60s) |

The API only serves the manifest + freshness once `STREAMS_BULK_PUBLIC_BASE_URL`
is set; the publisher only writes once `STREAMS_BULK_PUBLISHER_ENABLED=true` and
the R2 vars are present.

## 3. Verify

```
# Manifest served by the API (proxied from the public bucket):
curl -s https://api.secondlayer.tools/public/streams/dumps/manifest | jq '.coverage, .latest_finalized_cursor'

# Freshness in public status:
curl -s https://api.secondlayer.tools/public/status | jq '.streams.dumps'

# End-to-end client pull (no API key needed; dumps are public):
SL_STREAMS_DUMPS_URL=<public-base> sl streams pull --to ./dump --to-block 9999
```

Expect a manifest with real `files[]`, a non-null `latest_finalized_cursor`, and
`streams.dumps.status: "ok"`.

## 4. Public contract

- **Manifest**: `GET /public/streams/dumps/manifest` → `{ dataset, network,
  version, generated_at, finality_lag_blocks, latest_finalized_cursor,
  coverage: { from_block, to_block }, files: [{ path, from_block, to_block,
  min_cursor, max_cursor, row_count, byte_size, sha256, ... }] }`.
- **Files**: each `path` is the object key under `STREAMS_BULK_PUBLIC_BASE_URL`;
  download URL is `<base>/<path>`. Always verify `sha256` (the SDK/CLI do).
- **Resume seam**: hand `latest_finalized_cursor` to live tailing — cursor input
  is exclusive, so there's no gap or duplicate. `events.replay()` does this
  automatically.

## Finality

The publisher gates eligible ranges on the **same burn-block (BTC) confirmation
boundary as the read path** (`@secondlayer/shared` `finalizedBurnHeight` →
indexer `getFinalizedStacksHeight`, default 6 confirmations). It derives the
finalized Stacks height from the canonical tip's `burn_block_height` and only
publishes complete ranges at or below it, so dumps and live reads agree on what
is final.

- Tune with `STREAMS_BULK_BTC_CONFIRMATIONS` (default 6). The legacy
  `STREAMS_BULK_FINALITY_LAG_BLOCKS` (144 Stacks-block lag) is **no longer read**
  on the streams path — remove it from prod `.env` to avoid confusion.
- The manifest's `finality_lag_blocks` now reports the *observed* lag
  (`tip_height − finalized_height`) at publish time, not a fixed constant.
