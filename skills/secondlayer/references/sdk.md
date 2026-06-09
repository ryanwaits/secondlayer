# `@secondlayer/sdk` — TypeScript Reference

Source of truth: `packages/sdk/src/`. Function signatures below are copied verbatim — match them exactly when generating code.

**Auth model:** `sl.datasets.*`, `sl.contracts.*`, `sl.index.*` are **anonymous** — no API key required. `sl.subgraphs.rows()` (the open /v1 read) is anonymous for **public** subgraphs only; **private** subgraphs (incl. all pre-existing ones — migrated private) need the owner's `sk-sl_` key, anon → 404. The /api-backed read methods (list/get/openapi/schema/markdown/queryTable/queryTableCount/gaps/getSource) sit on the authed control plane (note: `sl.index.*` rejects free-tier keys — Build+ for keyed access). **`sl.streams.*` reads REQUIRE a bearer token** and resolve a per-tier tenant (free/build/scale/enterprise); a publicly-known free-tier token exists but a bearer is always required. Write paths (`subgraphs.deploy/reindex/backfill/stop/delete/bundle`, all `sl.subscriptions.*`) **require `apiKey`**. Bulk Streams dumps (`client.dumps`, `events.replay`, `GET /public/streams/dumps/manifest`) are **public** — no key.

**Key products & scope:** every `sk-sl_` key (set as `SL_API_KEY`) has a `product` that scopes it. An **`account`** key is the owner key — it grants BOTH `streams:read` and `index:read`, and is the **only** key allowed to mint new keys. A **`streams`** or **`index`** key is a scoped single-product read key and **cannot mint** (403). Dashboard keys default to `account`. Mint scoped keys programmatically with `sl.apiKeys.create({ product })` (requires an account/owner key); minted keys are always scoped and inherit your account plan's tier (never escalatable):

```ts
const { key, prefix, id, product, tier, createdAt } =
  await sl.apiKeys.create({ product: "streams", name: "ci" });
// `key` (sk-sl_…) is returned ONCE — store it now. `product` defaults to "streams" (or "index").
```

---

## 1. Install and import

```bash
bun add @secondlayer/sdk
```

```ts
import { SecondLayer } from "@secondlayer/sdk";
```

---

## 2. Client construction

```ts
// packages/sdk/src/base.ts
// Construct with `new SecondLayer(opts?)` — opts is Partial<SecondLayerOptions>,
// so every field is optional; baseUrl defaults to https://api.secondlayer.tools.
export interface SecondLayerOptions {
  /** Base URL of the Secondlayer platform API (trailing slashes are stripped). */
  baseUrl: string;
  /** Bearer token for authenticated requests. */
  apiKey?: string;
  /** Fetch implementation. Tests and edge runtimes can provide their own. */
  fetchImpl?: FetchLike;
  /** Deploy origin label sent as `x-sl-origin` (telemetry). Defaults to `cli`. */
  origin?: "cli" | "mcp" | "session";
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
```

```ts
// All options are optional. Default baseUrl = "https://api.secondlayer.tools".
const sl = new SecondLayer({
  apiKey: process.env.SL_API_KEY,           // optional for read-only methods
  baseUrl: "https://api.secondlayer.tools", // default
  // fetchImpl: customFetch,                // optional, for edge runtimes
  // origin: "cli",                         // default; "mcp" | "session"
});
```

`SecondLayer` exposes six resource clients:

```ts
sl.streams        // StreamsClient
sl.index          // Index
sl.datasets       // Datasets — Foundation Datasets, incl. listDatasets() catalog
sl.contracts      // Contracts — trait-based contract discovery
sl.subgraphs      // Subgraphs
sl.subscriptions  // Subscriptions
```

Discover what exists at runtime: `sl.datasets.listDatasets()` returns the dataset
catalog + freshness, and `sl.contracts.list({ trait: "sip-010" })` finds deployed
contracts conforming to a trait.

---

## 3. Subpath exports

```ts
// @secondlayer/sdk/streams — bare streams client, no platform wrappers
import {
  createStreamsClient,
  decodeFtTransfer,
  decodeNftTransfer,
  isFtTransfer,
  isNftTransfer,
  AuthError,
  RateLimitError,
  StreamsServerError,
  StreamsSignatureError,
  ValidationError,
  STREAMS_EVENT_TYPES,
} from "@secondlayer/sdk/streams";
import type {
  StreamsClient,
  StreamsEvent,
  StreamsEventType,
  StreamsEventsEnvelope,
  StreamsEventsListParams,
  StreamsEventsConsumeParams,
  StreamsEventsStreamParams,
  StreamsTip,
  StreamsReorg,
  StreamsCanonicalBlock,
  StreamsDumpFile,
  StreamsDumps,
  StreamsDumpsManifest,
  DecodedFtTransfer,
  DecodedNftTransfer,
  FtTransferEvent,
  NftTransferEvent,
} from "@secondlayer/sdk/streams";

const streams = createStreamsClient({ apiKey: process.env.SL_API_KEY }); // bearer required for reads
```

```ts
// @secondlayer/sdk/subgraphs — typed-client helpers
import { Subgraphs, getSubgraph } from "@secondlayer/sdk/subgraphs";
import type {
  SubgraphAgentSchema,
  SubgraphSpecFormat,
  SubgraphSpecOptions,
} from "@secondlayer/sdk/subgraphs";
```

The root `@secondlayer/sdk` re-exports everything above plus `SecondLayer`, `Index`, `Subgraphs`, `Subscriptions`, `ApiError`, `VersionConflictError`, `verifyWebhookSignature`, and all subscription/index/subgraph types.

---

## 4. `sl.streams` — Stacks event stream

### `createStreamsClient(options)` — bare client options

`sl.streams` is constructed for you; use `createStreamsClient` for focused Streams-only consumers. Beyond `apiKey` / `baseUrl` / `fetchImpl`, it accepts:

```ts
type CreateStreamsClientOptions = {
  apiKey?: string;          // bearer — REQUIRED for reads (per-tier tenant)
  baseUrl?: string;         // default https://api.secondlayer.tools
  fetchImpl?: FetchLike;
  /** Verify the ed25519 response signature on every read. Default OFF.
   *  `true` auto-fetches the public key from /public/streams/signing-key;
   *  `{ publicKey }` pins a PEM. A missing/bad signature throws StreamsSignatureError. */
  verify?: boolean | { publicKey: string };
  /** Public bulk-dump bucket base URL — required to use `client.dumps`. */
  dumpsBaseUrl?: string;
};
```

```ts
// StreamsEventType — exact enum from packages/sdk/src/streams/types.ts
export const STREAMS_EVENT_TYPES = [
  "stx_transfer", "stx_mint", "stx_burn", "stx_lock",
  "ft_transfer", "ft_mint", "ft_burn",
  "nft_transfer", "nft_mint", "nft_burn",
  "print",
] as const;
export type StreamsEventType = (typeof STREAMS_EVENT_TYPES)[number];
```

### Event shape

`StreamsEvent` is a discriminated union on `event_type`, so `event.payload`
narrows to the matching per-type shape (e.g. `FtTransferPayload`, `PrintPayload`)
once you check `event.event_type` (or use an `isX` guard) — no cast needed.

```ts
// Common fields (StreamsEventBase) + a typed payload per event_type:
type StreamsEvent =
  | (StreamsEventBase & { event_type: "ft_transfer"; payload: FtTransferPayload })
  | (StreamsEventBase & { event_type: "print"; payload: PrintPayload })
  | /* …stx_*, ft_*, nft_* … */;

type StreamsEventBase = {
  cursor: string;
  block_height: number;
  block_hash: string;
  burn_block_height: number;
  tx_id: string;
  tx_index: number;
  event_index: number;
  contract_id: string | null;
  ts: string;
  finalized?: boolean; // true when the block is past the finality boundary
};

// for (const e of envelope.events)
//   if (e.event_type === "ft_transfer") e.payload.amount  // string, typed

export type StreamsEventsEnvelope = {
  events: StreamsEvent[];
  next_cursor: string | null;
  tip: StreamsTip;
  reorgs: StreamsReorg[];
};

export type StreamsEventsListEnvelope = Omit<StreamsEventsEnvelope, "next_cursor">;
```

### `sl.streams.tip()`

```ts
tip(): Promise<StreamsTip>

type StreamsTip = {
  block_height: number;
  block_hash: string;
  burn_block_height: number;
  lag_seconds: number;
  finalized_height?: number; // highest immutable (past-finality) block
};
```

```ts
const tip = await sl.streams.tip();
console.log(`At block ${tip.block_height}, lag ${tip.lag_seconds}s`);
```

### `sl.streams.events.list(params?)`

```ts
type StreamsFilterValue = string | readonly string[]; // one value or a list (matches any)

type StreamsEventsListParams = {
  cursor?: string | null;
  fromHeight?: number;
  toHeight?: number;
  types?: readonly StreamsEventType[];
  notTypes?: readonly StreamsEventType[]; // exclude these types (applied after `types`)
  contractId?: StreamsFilterValue;
  sender?: StreamsFilterValue;       // payload sender (events that have one)
  recipient?: StreamsFilterValue;    // payload recipient
  assetIdentifier?: string;          // exact FT/NFT asset identifier
  limit?: number;
};

list(params?: StreamsEventsListParams): Promise<StreamsEventsEnvelope>
```

```ts
const page = await sl.streams.events.list({
  types: ["ft_transfer"],
  contractId: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-abtc",
  limit: 100,
});
for (const ev of page.events) console.log(ev.cursor, ev.payload);
const next = page.next_cursor; // pass back as `cursor` to continue
```

### `sl.streams.events.byTxId(txId)`

```ts
byTxId(txId: string): Promise<StreamsEventsListEnvelope>
```

```ts
const { events } = await sl.streams.events.byTxId(
  "0x4b1c8e9d3b...c1a2",
);
```

### `sl.streams.events.consume(params)` — checkpoint-driven puller

Use for indexers/ETL that own cursor checkpointing. The SDK owns the cursor (where to poll next, reorg dedup + rewind) and hands you the checkpoint to persist via `ctx.cursor` — write it in the **same transaction** as your projection rows. Key rows by `event.cursor` (the stable per-event id) so replaying a batch is an idempotent no-op.

```ts
type StreamsEventsConsumeParams = {
  fromCursor?: string | null;
  mode?: "tail" | "bounded";        // default "tail"
  finalizedOnly?: boolean;          // emit only immutable events; never surfaces reorgs
  types?: readonly StreamsEventType[];
  notTypes?: readonly StreamsEventType[];
  contractId?: StreamsFilterValue;  // string | readonly string[]
  sender?: StreamsFilterValue;
  recipient?: StreamsFilterValue;
  assetIdentifier?: string;
  batchSize?: number;               // default 100
  onBatch: (
    events: StreamsEvent[],
    envelope: StreamsEventsEnvelope,
    ctx: { cursor: string | null },  // checkpoint to persist for this batch
  ) => void | string | null | undefined | Promise<void | string | null | undefined>;
  onReorg?: (
    reorg: StreamsReorg,
    ctx: { cursor: string },         // rewind cursor to persist with the rollback
  ) => void | Promise<void>;
  emptyBackoffMs?: number;          // default 500
  maxPages?: number;
  maxEmptyPolls?: number;
  signal?: AbortSignal;
};

consume(params: StreamsEventsConsumeParams): Promise<{
  cursor: string | null;
  pages: number;
  emptyPolls: number;
}>
```

Reorg-aware indexer — `onBatch` applies, `onReorg` rolls back, both persist `ctx.cursor` in their own transaction:

```ts
await sl.streams.events.consume({
  fromCursor: await loadCheckpoint(),   // your durable store
  types: ["ft_transfer", "nft_transfer"],
  batchSize: 250,
  onBatch(events, _envelope, { cursor }) {
    db.transaction(() => {
      for (const ev of events) upsertByCursor(ev); // PK = ev.cursor
      saveCheckpoint(cursor);                       // atomic with the writes
    });
  },
  onReorg(reorg, { cursor }) {
    db.transaction(() => {
      deleteRowsAboveHeight(reorg.fork_point_height); // roll back the fork
      saveCheckpoint(cursor);                         // SDK rewinds + re-reads
    });
  },
});
```

Omit `onReorg` only if you don't store reorg-eligible (unfinalized) data — events stay canonical, but stale rows from an orphaned fork are left in place.

`finalizedOnly: true` is the zero-reorg path — it emits only immutable events and checkpoints at the last finalized one (so `ctx.cursor` is always safe to persist and `onReorg` is never needed), trading finality lag for simplicity:

```ts
await sl.streams.events.consume({
  finalizedOnly: true,
  types: ["ft_transfer"],
  onBatch(events, _envelope, { cursor }) {
    db.transaction(() => { for (const ev of events) upsertByCursor(ev); saveCheckpoint(cursor); });
  },
});
```

`mode: "bounded"` exits on the first empty page — useful for backfills. `signal` lets you abort cleanly on shutdown. Returning a cursor from `onBatch` still overrides `ctx.cursor` for advanced manual control. Reach for raw cursors via the exported `Cursor` helper (`Cursor.atHeight(h)`, `Cursor.parse(c)`) rather than string-building the `<block>:<index>` format.

### `sl.streams.events.stream(params?)` — async iterator

For live watchers/processors that don't need explicit checkpointing.

```ts
type StreamsEventsStreamParams = {
  fromCursor?: string | null;
  types?: readonly StreamsEventType[];
  notTypes?: readonly StreamsEventType[];
  contractId?: StreamsFilterValue;  // string | readonly string[]
  sender?: StreamsFilterValue;
  recipient?: StreamsFilterValue;
  assetIdentifier?: string;
  batchSize?: number;               // default 100
  emptyBackoffMs?: number;          // default 500
  maxPages?: number;
  maxEmptyPolls?: number;
  signal?: AbortSignal;
};

stream(params?: StreamsEventsStreamParams): AsyncIterable<StreamsEvent>
```

```ts
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());

for await (const ev of sl.streams.events.stream({
  types: ["ft_transfer"],
  signal: controller.signal,
})) {
  if (isFtTransfer(ev)) {
    const { decoded_payload } = decodeFtTransfer(ev);
    console.log(`${decoded_payload.sender} -> ${decoded_payload.recipient}: ${decoded_payload.amount}`);
  }
}
```

### `sl.streams.blocks.events(heightOrHash)`

```ts
events(heightOrHash: number | string): Promise<StreamsEventsListEnvelope>
```

```ts
const byHeight = await sl.streams.blocks.events(170_000);
const byHash   = await sl.streams.blocks.events("0xabc...");
```

### `sl.streams.reorgs.list(params)`

```ts
type StreamsReorgsListParams = { since: string; limit?: number };
type StreamsReorg = {
  detected_at: string;
  fork_point_height: number;
  orphaned_range: { from: string; to: string };
  new_canonical_tip: string;
};
type StreamsReorgsListEnvelope = {
  reorgs: StreamsReorg[];
  next_since: string | null;
};

list(params: StreamsReorgsListParams): Promise<StreamsReorgsListEnvelope>
```

```ts
const { reorgs, next_since } = await sl.streams.reorgs.list({
  since: "2026-05-17T00:00:00Z",
  limit: 50,
});
```

### `sl.streams.canonical(height)`

```ts
canonical(height: number): Promise<StreamsCanonicalBlock>

type StreamsCanonicalBlock = {
  block_height: number;
  block_hash: string;
  burn_block_height: number;
  burn_block_hash: string | null;
  is_canonical: true;
};
```

```ts
const block = await sl.streams.canonical(170_000);
```

### `sl.streams.dumps` — bulk parquet dumps

Public bulk backfill from finalized parquet files. Requires `dumpsBaseUrl` on the client. The SDK does **not** decode parquet — `download` / `replay` hand you the raw bytes/file to process with your own tooling.

```ts
type StreamsDumpFile = {
  file: string;
  sha256: string;
  // …plus block range / cursor metadata from the manifest
};
type StreamsDumpsManifest = {
  files: StreamsDumpFile[];
  latest_finalized_cursor: string | null;
};

list(): Promise<StreamsDumpsManifest>          // parse the manifest
fileUrl(file: StreamsDumpFile | string): string
download(file: StreamsDumpFile): Promise<Uint8Array> // fetches + verifies sha256
```

```ts
const streams = createStreamsClient({
  apiKey: process.env.SL_API_KEY,
  dumpsBaseUrl: process.env.SL_STREAMS_DUMPS_URL,
});

const manifest = await streams.dumps.list();
for (const f of manifest.files) {
  const bytes = await streams.dumps.download(f); // sha256-verified parquet
  await myParquetReader(bytes);
}
```

### `sl.streams.events.replay(params)` — bulk backfill then live tail

Backfills from bulk dumps, then tails live from the manifest's `latest_finalized_cursor` — no gap or dupe at the seam. `onDumpFile` hands you each finalized parquet file to process with your own tooling (the SDK doesn't decode parquet); `onBatch` receives live events after the seam.

```ts
type StreamsEventsReplayParams = {
  from?: "genesis" | string;                     // "genesis" (default) or a start cursor
  onDumpFile: (file: StreamsDumpFile) => Promise<void> | void;
  onBatch: (
    events: StreamsEvent[],
    envelope: StreamsEventsEnvelope,
  ) => Promise<string | null | undefined> | string | null | undefined;
};

replay(params: StreamsEventsReplayParams): Promise<StreamsEventsConsumeResult>
```

```ts
await streams.events.replay({
  from: lastCheckpoint,
  async onDumpFile(file) {
    const bytes = await streams.dumps.download(file);
    await ingestParquet(bytes);            // your tooling
  },
  async onBatch(events, envelope) {
    for (const ev of events) await handle(ev);
    return envelope.next_cursor;
  },
});
```

### Decoders (sync helpers)

```ts
// FT transfer
type FtTransferPayload = {
  asset_identifier: string;
  sender: string;
  recipient: string;
  amount: string; // decimal string
};
type DecodedFtTransferPayload = {
  asset_identifier: string;
  contract_id: string;
  token_name: string | null;
  sender: string;
  recipient: string;
  amount: string;
};

isFtTransfer(event: StreamsEvent): event is FtTransferEvent
decodeFtTransfer(event: StreamsEvent): DecodedFtTransfer
```

```ts
// NFT transfer
type NftTransferPayload = {
  asset_identifier: string;
  sender: string;
  recipient: string;
  value: string | { hex: string };
};
type DecodedNftTransferPayload = {
  asset_identifier: string;
  contract_id: string;
  token_name: string | null;
  sender: string;
  recipient: string;
  value: string; // hex-encoded Clarity value
};

isNftTransfer(event: StreamsEvent): event is NftTransferEvent
decodeNftTransfer(event: StreamsEvent): DecodedNftTransfer
```

```ts
for await (const ev of sl.streams.events.stream()) {
  if (isFtTransfer(ev)) {
    const d = decodeFtTransfer(ev);
    const amount = BigInt(d.decoded_payload.amount); // safe for arbitrary precision
  }
  if (isNftTransfer(ev)) {
    const d = decodeNftTransfer(ev);
    console.log(d.decoded_payload.value); // "0x0100000000000000000000000000000034"
  }
}
```

---

## 5. `sl.index` — server-decoded FT/NFT transfers

Same physical data as `sl.streams` but pre-decoded and pre-filtered for the two most common queries. Cursor-paginated.

```ts
type IndexTip = { block_height: number; lag_seconds: number };
```

### FT transfers

```ts
type FtTransfer = {
  cursor: string;
  block_height: number;
  tx_id: string;
  tx_index: number;
  event_index: number;
  event_type: "ft_transfer";
  contract_id: string;
  asset_identifier: string;
  sender: string;
  recipient: string;
  amount: string;
};

type FtTransfersEnvelope = {
  events: FtTransfer[];
  next_cursor: string | null;
  tip: IndexTip;
  reorgs: never[]; // reserved
};

type FtTransfersListParams = {
  cursor?: string | null;
  fromCursor?: string | null;
  limit?: number;
  contractId?: string;
  sender?: string;
  recipient?: string;
  fromHeight?: number;
  toHeight?: number;
};

type FtTransfersWalkParams = Omit<FtTransfersListParams, "limit"> & {
  batchSize?: number;        // default 200
  signal?: AbortSignal;
};

sl.index.ftTransfers.list(params?: FtTransfersListParams): Promise<FtTransfersEnvelope>
sl.index.ftTransfers.walk(params?: FtTransfersWalkParams): AsyncIterable<FtTransfer>
```

```ts
// Page-by-page
const first = await sl.index.ftTransfers.list({
  recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  limit: 100,
});
const more  = await sl.index.ftTransfers.list({ cursor: first.next_cursor });

// Iterator (walks all pages)
const controller = new AbortController();
for await (const t of sl.index.ftTransfers.walk({
  contractId: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-abtc",
  signal: controller.signal,
})) {
  const amount = BigInt(t.amount);
  if (amount >= 1_000_000n) console.log("whale", t.tx_id);
}
```

### NFT transfers

```ts
type NftTransfer = {
  cursor: string;
  block_height: number;
  tx_id: string;
  tx_index: number;
  event_index: number;
  event_type: "nft_transfer";
  contract_id: string;
  asset_identifier: string;
  sender: string;
  recipient: string;
  value: string; // hex Clarity value
};

type NftTransfersEnvelope = {
  events: NftTransfer[];
  next_cursor: string | null;
  tip: IndexTip;
  reorgs: never[];
};

type NftTransfersListParams = {
  cursor?: string | null;
  fromCursor?: string | null;
  limit?: number;
  contractId?: string;
  assetIdentifier?: string;
  sender?: string;
  recipient?: string;
  fromHeight?: number;
  toHeight?: number;
};

type NftTransfersWalkParams = Omit<NftTransfersListParams, "limit"> & {
  batchSize?: number;        // default 200
  signal?: AbortSignal;
};

sl.index.nftTransfers.list(params?: NftTransfersListParams): Promise<NftTransfersEnvelope>
sl.index.nftTransfers.walk(params?: NftTransfersWalkParams): AsyncIterable<NftTransfer>
```

```ts
for await (const nft of sl.index.nftTransfers.walk({
  assetIdentifier: "SP000000000000000000002Q6VF78.bns::names",
})) {
  console.log(nft.tx_id, nft.value);
}
```

Note `.walk()` defaults `fromHeight: 0` when neither `cursor` nor `fromCursor` is supplied — pass an explicit `fromHeight` if you want to start at the tip.

---

## 5b. `Datasets` — Foundation Datasets

Typed client for `/v1/datasets/*` (public reads, no key). Cursor-paginated event
datasets share a `list`/`walk` shape; offset/single-object ones have bespoke methods.

Also on the root client as `sl.datasets` (no separate import needed).

```ts
import { Datasets } from "@secondlayer/sdk";
const ds = new Datasets({ baseUrl: "https://api.secondlayer.tools" });

// discovery: catalog + freshness — call this first to learn what exists
const catalog = await ds.listDatasets();

// cursor datasets: pox4Calls, sbtcEvents, sbtcTokenEvents, stxTransfers,
// bnsEvents, bnsNamespaceEvents, bnsMarketplaceEvents,
// burnchainRewards, burnchainRewardSlots
const { rows, next_cursor } = await ds.pox4Calls.list({ address: "SP…", limit: 20 });
for await (const row of ds.sbtcEvents.walk({ batchSize: 500 })) { /* … */ }

// Bitcoin PoX reward payouts (go-forward), filter by reward address:
await ds.burnchainRewards.list({ recipient: "bc1q…", limit: 20 });

// bespoke
await ds.bnsResolve("alice.btc");      // single record
await ds.bnsNames({ namespace: "btc", offset: 0 });  // offset-paginated
await ds.networkHealth();              // summary
```

Rows are `DatasetRow` (JSON) in v1; query params are typed per dataset.

---

## 5c. `sl.contracts` — contract discovery

Typed client for `GET /v1/contracts` (public reads, no key). "Find all contracts
conforming to a trait" — `trait` is required.

```ts
// also standalone: import { Contracts } from "@secondlayer/sdk"
const { contracts, next_cursor } = await sl.contracts.list({
  trait: "sip-010",          // required
  conformance: "any",        // "declared" | "inferred" | "any" (default any)
  include: "abi",            // omit to exclude the ABI blob
  limit: 100,                // 1–500
});
```

---

## 6. `sl.subgraphs`

`rows()` (open /v1 read) is anonymous for **public** subgraphs; private subgraphs need the owner's `apiKey` (anon → 404). **Write methods (`deploy`, `publish`, `unpublish`, `reindex`, `backfill`, `stop`, `delete`, `bundle`) require `apiKey`.**

### `list()`

```ts
list(): Promise<{ data: SubgraphSummary[] }>

interface SubgraphSummary {
  name: string;
  version: string;
  status: string;
  lastProcessedBlock: number;
  totalProcessed: number;
  totalErrors: number;
  tables: string[];
  chainTip: number;
  sourceChainTip?: number;
  targetBlock?: number;
  progress: number;
  blocksRemaining?: number;
  syncMode?: "sync" | "reindex";
  resourceWarning?: SubgraphResourceWarning;
  gapCount: number;
  integrity: "complete" | "gaps_detected";
  createdAt: string;
}
```

### `get(name)`

```ts
get(name: string): Promise<SubgraphDetail>
```

`SubgraphDetail` adds `health`, `sync`, and a `tables` map keyed by table name with `endpoint`, `columns`, `rowCount`, `example`, `indexes`, `uniqueKeys`. See `packages/shared/src/schemas/subgraphs.ts`.

### `openapi(name, options?)`, `schema(name, options?)`, `markdown(name, options?)`

```ts
interface SubgraphSpecOptions {
  serverUrl?: string;
  generatedAt?: string;
}

openapi(name: string, options?: SubgraphSpecOptions): Promise<Record<string, unknown>>
schema(name: string, options?: SubgraphSpecOptions):  Promise<SubgraphAgentSchema>
markdown(name: string, options?: SubgraphSpecOptions): Promise<string>
```

`SubgraphAgentSchema` is the agent-oriented JSON description (tables, query params, examples). `markdown` returns prose docs as a string.

### `rows(name, table, params?)` — open /v1 read

```ts
rows<T = unknown>(
  name: string,
  table: string,
  params?: Omit<SubgraphQueryParams, "offset" | "sort"> & { cursor?: string },
): Promise<SubgraphRowsEnvelope<T>>

interface SubgraphRowsEnvelope<T = unknown> {
  rows: T[];
  next_cursor: string | null;
  tip: { block_height: number; subgraph_height: number; blocks_behind: number };
}
```

Hits `GET /v1/subgraphs/<name>/<table>` — anon for public subgraphs, owner `apiKey` for private. `_id` keyset pagination: pass `cursor: next_cursor` to resume, `order: "asc" | "desc"` for direction. No `offset`/`sort` on /v1.

### `publish(name)` / `unpublish(name)` — need `apiKey`

```ts
publish(name: string): Promise<{ name: string; visibility: "public"; url: string }>
unpublish(name: string): Promise<{ name: string; visibility: "private" }>
```

`publish` claims the global public name — 409 `PUBLIC_NAME_TAKEN` if claimed. Deploy also accepts `visibility?: "public" | "private"` (managed default public, BYO default private).

### `queryTable(name, table, params?)`

```ts
interface SubgraphQueryParams {
  sort?: string;
  order?: string;             // "asc" | "desc"
  limit?: number;
  offset?: number;
  fields?: string;            // comma-separated column list
  filters?: Record<string, string>; // e.g. { "amount.gte": "1000" }
}

queryTable(name: string, table: string, params?: SubgraphQueryParams): Promise<unknown[]>
queryTableCount(name: string, table: string, params?: SubgraphQueryParams): Promise<{ count: number }>
```

```ts
const rows = await sl.subgraphs.queryTable("sbtc", "transfers", {
  filters: { sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7" },
  sort: "_block_height",
  order: "desc",
  limit: 50,
});

const { count } = await sl.subgraphs.queryTableCount("sbtc", "transfers", {
  filters: { "amount.gte": "100000000" },
});
```

### `deploy(data)` — needs `apiKey`

```ts
interface DeploySubgraphRequest {
  name: string;
  version?: string;
  description?: string;
  sources: Record<string, Record<string, unknown>>;
  schema: Record<string, unknown>;
  handlerCode: string;
  /** Override the definition's startBlock for this deploy only. */
  startBlock?: number;
  /** Original TypeScript source, persisted for chat read/diff/edit. */
  sourceCode?: string;
}

interface DeploySubgraphResponse {
  action: "created" | "unchanged" | "handler_updated" | "updated" | "reindexed";
  subgraphId: string;
  version: string;
  message: string;
  operationId?: string;
  reindexStarted?: boolean;
  diff?: {
    addedTables: string[];
    removedTables: string[];
    addedColumns: Record<string, string[]>;
    breakingChanges: string[];
  };
}

deploy(data: DeploySubgraphRequest): Promise<DeploySubgraphResponse>
```

In practice, prefer the `sl subgraphs deploy` CLI — it bundles the TypeScript module and computes `sources`/`handlerCode` for you.

### `reindex`, `backfill`, `stop` — need `apiKey`

```ts
interface ReindexResponse {
  message: string;
  fromBlock: number;
  toBlock: number | string;
  operationId?: string;
  status?: "queued" | "running" | "cancel_requested";
}

reindex(name: string, options?: { fromBlock?: number; toBlock?: number }): Promise<ReindexResponse>
backfill(name: string, options: { fromBlock: number; toBlock: number }): Promise<ReindexResponse>
stop(name: string): Promise<{ message: string; operationId?: string; status?: string }>
```

### `gaps(name, opts?)`

```ts
interface SubgraphGapEntry {
  start: number;
  end: number;
  size: number;
  reason: string;
  detectedAt: string;
  resolvedAt: string | null;
}

interface SubgraphGapsResponse {
  data: SubgraphGapEntry[];
  meta: { total: number; totalMissingBlocks: number; limit: number; offset: number };
}

gaps(name: string, opts?: { limit?: number; offset?: number; resolved?: boolean }): Promise<SubgraphGapsResponse>
```

### `delete(name, options?)` — needs `apiKey`

```ts
delete(name: string, options?: { force?: boolean }): Promise<{ message: string }>
```

### `getSource(name)`, `bundle(data)`

```ts
interface SubgraphSource {
  name: string;
  version: string;
  sourceCode: string | null;
  readOnly: boolean;
  reason?: string;
  updatedAt: string;
}

interface BundleSubgraphResponse {
  ok: true;
  name: string;
  version: string | null;
  description: string | null;
  sources: Record<string, Record<string, unknown>>;
  schema: Record<string, unknown>;
  handlerCode: string;
  sourceCode: string;
  bundleSize: number;
}

getSource(name: string): Promise<SubgraphSource>
bundle(data: { code: string }): Promise<BundleSubgraphResponse> // needs apiKey
```

### `typed(def)` — inferred row types from a `defineSubgraph()` literal

> **If you only have a deployed subgraph (no local source file):** run `sl subgraphs generate <name> -o src/client.ts` first. It introspects the deployed schema and writes a typed module you can import directly. Use `typed()` only when you already have the `defineSubgraph(...)` literal in scope (you wrote the subgraph in this project).

```ts
typed<T extends { name: string; schema: Record<string, unknown> }>(
  def: T,
): InferSubgraphClient<T>
```

Each table on the returned client has:

```ts
interface SubgraphTableClient<TRow> {
  findMany(options?: FindManyOptions<TRow>): Promise<TRow[]>;
  count(where?: WhereInput<TRow> & SystemWhereAliases): Promise<number>;
  // Realtime: stream rows as they're indexed (SSE). Returns an unsubscribe fn.
  subscribe(onRow: (row: TRow) => void, options?: SubscribeOptions<TRow>): () => void;
}

interface SubscribeOptions<TRow> {
  where?: WhereInput<TRow> & SystemWhereAliases; // same filters as findMany
  since?: number;                                // replay from this block, then tail
  onError?: (err: unknown) => void;
}

interface FindManyOptions<TRow> {
  where?: WhereInput<TRow> & SystemWhereAliases;
  orderBy?: { [K in keyof TRow]?: "asc" | "desc" } & SystemOrderByAliases;
  limit?: number;
  offset?: number;
  fields?: (keyof TRow & string)[];
}

type WhereInput<TRow> = {
  [K in keyof TRow]?: TRow[K] | ComparisonFilter<TRow[K]>;
};

type ComparisonFilter<T> = {
  eq?: T; neq?: T; gt?: T; gte?: T; lt?: T; lte?: T;
};
```

Every row also carries system columns:

```ts
interface SystemRow {
  _id: string;
  _blockHeight: bigint;
  _txId: string;
  _createdAt: string;
}
```

Aliases `blockHeight` / `txId` / `createdAt` / `id` (no underscore) are accepted in `where` and `orderBy` and rewritten to the canonical `_block_height` etc.

```ts
import mySubgraph from "./subgraphs/sbtc.ts";

const client = sl.subgraphs.typed(mySubgraph);

const transfers = await client.transfers.findMany({
  where: {
    sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    amount: { gte: 1_000_000n },
    blockHeight: { gte: 170_000n },
  },
  orderBy: { blockHeight: "desc" },
  limit: 100,
});

// Realtime: react to rows as they're indexed (block-cadence) over SSE.
// Browser-friendly — no webhook endpoint needed. Requires a global EventSource
// (browsers, or Node >= 22). Public path: GET /v1/subgraphs/<name>/<table>/stream
// (anon for public subgraphs; /api equivalent stays on the authed control plane).
const unsubscribe = client.transfers.subscribe(
  (row) => console.log("new transfer", row.sender, row.amount),
  { where: { amount: { gte: 1_000_000n } } },
);
// later: unsubscribe();

const big = await client.transfers.count({ amount: { gte: 100_000_000n } });
```

Equivalent helper for callers that don't have a `SecondLayer` instance:

```ts
import { getSubgraph } from "@secondlayer/sdk";
const client = getSubgraph(mySubgraph, { apiKey: process.env.SL_API_KEY });
// also accepts an existing SecondLayer or Subgraphs instance
```

> `orderBy` supports a single column — passing multiple keys throws synchronously.

---

## 7. `sl.subscriptions` — webhook subscriptions

**All methods require `apiKey`.**

A subscription is one of two **kinds** (mutually exclusive):
- **`subgraph`** — fires on rows written to a deployed subgraph's table (`subgraphName` + `tableName` + column `filter`).
- **`chain`** — fires on **raw chain events directly, no subgraph** (`triggers`). The turnkey "webhook on a contract / event-type / function-call (or any SIP-010/SIP-009/custom trait)". Built off the public Index/Streams clock; **forward-looking** (starts at chain tip, never backfills).

Both kinds share the same delivery stack (retries, circuit breaker, 6 formats, per-subscription HMAC signing) and the same routes below.

### Shared types

```ts
type SubscriptionStatus  = "active" | "paused" | "error";
type SubscriptionFormat  = "standard-webhooks" | "inngest" | "trigger" | "cloudflare" | "cloudevents" | "raw";
type SubscriptionRuntime = "inngest" | "trigger" | "cloudflare" | "node";

type SubscriptionFilterPrimitive = string | number | boolean;
type SubscriptionFilterOperator =
  | { eq: SubscriptionFilterPrimitive }
  | { neq: SubscriptionFilterPrimitive }
  | { gt:  string | number }
  | { gte: string | number }
  | { lt:  string | number }
  | { lte: string | number }
  | { in:  SubscriptionFilterPrimitive[] };
type SubscriptionFilterClause = SubscriptionFilterPrimitive | SubscriptionFilterOperator;
type SubscriptionFilter = Record<string, SubscriptionFilterClause>;

type SubscriptionKind = "subgraph" | "chain";

// Chain-trigger filter (the wire shape for chain subscriptions). Amounts are
// non-negative integer strings (uint128-safe) or numbers.
type ChainTrigger =
  | { type: "stx_transfer"; sender?: string; recipient?: string; minAmount?: string | number; maxAmount?: string | number }
  | { type: "stx_mint" | "stx_burn"; sender?: string; recipient?: string; minAmount?: string | number }
  | { type: "stx_lock"; lockedAddress?: string; minAmount?: string | number }
  | { type: "ft_transfer" | "ft_mint" | "ft_burn"; assetIdentifier?: string; sender?: string; recipient?: string; minAmount?: string | number; trait?: string }
  | { type: "nft_transfer" | "nft_mint" | "nft_burn"; assetIdentifier?: string; sender?: string; recipient?: string; trait?: string }
  | { type: "contract_call"; contractId?: string; functionName?: string; caller?: string; trait?: string }
  | { type: "contract_deploy"; deployer?: string; contractName?: string }
  | { type: "print_event"; contractId?: string; topic?: string; trait?: string };
// All string fields support `*` wildcards. `trait` scopes to contracts
// conforming to a SIP/trait (e.g. "sip-010") — resolved from the contract registry.

interface SubscriptionSummary {
  id: string;
  name: string;
  status: SubscriptionStatus;
  kind: SubscriptionKind;
  subgraphName: string | null;   // null for chain subscriptions
  tableName: string | null;      // null for chain subscriptions
  format: SubscriptionFormat;
  runtime: SubscriptionRuntime | null;
  url: string;
  lastDeliveryAt: string | null;
  lastSuccessAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionDetail extends SubscriptionSummary {
  filter: Record<string, unknown>;
  triggers: ChainTrigger[] | null;  // chain subscriptions only
  authConfig: Record<string, unknown>;
  maxRetries: number;
  timeoutMs: number;
  concurrency: number;
  circuitFailures: number;
  circuitOpenedAt: string | null;
  lastError: string | null;
}
```

### Delivery envelope (chain subscriptions)

Chain deliveries carry an **apply / rollback** envelope so consumers can reconcile reorgs:

```jsonc
// chain.{eventType}.apply  — a matched canonical event
{ "action": "apply", "block_hash": "0x..", "block_height": 152233, "tx_id": "0x..",
  "canonical": true, "trigger": "contract_call", "event": { /* the decoded event/tx */ } }

// chain.reorg.rollback  — emitted when delivered events get orphaned by a reorg
{ "action": "rollback", "fork_point_height": 152230,
  "orphaned": [ { "tx_id": "0x..", "event": { /* the previously-applied event */ } } ],
  "truncated": false }
```

Delivery is at-least-once. A tx that survives a reorg re-delivers an `apply` under its new `block_hash`; one that's orphaned for good only gets the `rollback`. Key your state on `(tx_id, block_hash)`.

### `list()`, `get(id)`

```ts
list(): Promise<{ data: SubscriptionSummary[] }>
get(id: string): Promise<SubscriptionDetail>
```

### `create(input)`

```ts
interface CreateSubscriptionRequest {
  name: string;
  url: string;                              // must start with http(s)://
  // Provide EITHER a subgraph target (subgraph subscription) ...
  subgraphName?: string;
  tableName?: string;
  filter?: SubscriptionFilter;
  // ... OR triggers (chain subscription). Mutually exclusive.
  triggers?: ChainTrigger[];                // 1..50
  format?: SubscriptionFormat;              // default "standard-webhooks"
  runtime?: SubscriptionRuntime | null;
  authConfig?: Record<string, unknown>;
  maxRetries?: number;                      // 0..100
  timeoutMs?: number;                       // 100..300_000
  concurrency?: number;                     // 1..100
}

interface CreateSubscriptionResponse {
  subscription: SubscriptionDetail;
  /** Plaintext signing secret — surfaced ONCE. Persist it server-side. */
  signingSecret: string;
}

create(input: CreateSubscriptionRequest): Promise<CreateSubscriptionResponse>
```

**Subgraph subscription** — react to processed table rows:

```ts
const { subscription, signingSecret } = await sl.subscriptions.create({
  name: "whale-alerts",
  subgraphName: "sbtc",
  tableName: "transfers",
  url: "https://example.com/webhooks/sbtc",
  filter: {
    amount: { gte: "100000000" }, // 1 sBTC = 1e8 sats
    sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  },
  format: "standard-webhooks",
  maxRetries: 10,
  timeoutMs: 10_000,
});

await secretStore.put(subscription.id, signingSecret); // store it NOW
```

**Chain subscription** — react to raw chain events, no subgraph. Use the `trigger.*` builders:

```ts
import { trigger } from "@secondlayer/sdk";

const { subscription, signingSecret } = await sl.subscriptions.create({
  name: "amm-swaps",
  url: "https://example.com/webhooks/swaps",
  triggers: [
    trigger.contractCall({ contractId: "SP...amm-v2", functionName: "swap-*" }),
    trigger.ftTransfer({ trait: "sip-010", minAmount: "1000000" }), // any SIP-010 transfer ≥ 1 token
  ],
});
```

`trigger` exposes one builder per event type: `stxTransfer/stxMint/stxBurn/stxLock`, `ftTransfer/ftMint/ftBurn`, `nftTransfer/nftMint/nftBurn`, `contractCall`, `contractDeploy`, `printEvent`. `update()` cannot switch a subscription's kind.

### `update(id, patch)`

```ts
interface UpdateSubscriptionRequest {
  name?: string;
  url?: string;
  filter?: SubscriptionFilter;
  format?: SubscriptionFormat;
  runtime?: SubscriptionRuntime | null;
  authConfig?: Record<string, unknown>;
  maxRetries?: number;
  timeoutMs?: number;
  concurrency?: number;
}

update(id: string, patch: UpdateSubscriptionRequest): Promise<SubscriptionDetail>
```

### `pause`, `resume`, `delete`

```ts
pause(id: string):  Promise<SubscriptionDetail>
resume(id: string): Promise<SubscriptionDetail>
delete(id: string): Promise<{ ok: true }>
```

### `rotateSecret(id)`

```ts
interface RotateSecretResponse {
  subscription: SubscriptionDetail;
  signingSecret: string; // new plaintext — store immediately
}

rotateSecret(id: string): Promise<RotateSecretResponse>
```

### `recentDeliveries(id)`, `dead(id)`

```ts
interface DeliveryRow {
  id: string;
  attempt: number;
  statusCode: number | null;
  errorMessage: string | null;
  durationMs: number | null;
  responseBody: string | null;
  dispatchedAt: string;
}

interface DeadRow {
  id: string;
  eventType: string;
  attempt: number;
  blockHeight: number;
  txId: string | null;
  payload: Record<string, unknown>;
  failedAt: string | null;
  createdAt: string;
}

recentDeliveries(id: string): Promise<{ data: DeliveryRow[] }>
dead(id: string):             Promise<{ data: DeadRow[] }>
```

### `replay(id, range)`

```ts
interface ReplayResult {
  replayId: string;
  enqueuedCount: number;
  scannedCount: number;
}

replay(id: string, range: { fromBlock: number; toBlock: number }): Promise<ReplayResult>
```

```ts
const { enqueuedCount } = await sl.subscriptions.replay(sub.id, {
  fromBlock: 170_000,
  toBlock:   170_500,
});
```

### `requeueDead(id, outboxId)`

```ts
requeueDead(id: string, outboxId: string): Promise<{ ok: true }>
```

```ts
const { data: dead } = await sl.subscriptions.dead(sub.id);
for (const row of dead) await sl.subscriptions.requeueDead(sub.id, row.id);
```

---

## 8. Errors

All errors live in `@secondlayer/sdk`.

### Platform: `ApiError`, `VersionConflictError`

Thrown by `sl.index.*`, `sl.subgraphs.*`, `sl.subscriptions.*`.

```ts
class ApiError extends Error {
  status: number;     // 0 for network/serialization failure
  body?: unknown;     // parsed JSON if available
  code?: string;      // stable machine code from server envelope, if any
}

class VersionConflictError extends ApiError {
  status: 409;
  currentVersion:  string;
  expectedVersion: string;
}
```

Fires when:

- `status === 0` — `fetch` rejected (network down) or the request body failed to serialize.
- `status === 401` — missing/invalid `apiKey` on a write method.
- `status === 429` — rate limited (`Retry-After` header reflected in `message`).
- `status >= 500` — upstream server error.
- `4xx` otherwise — the server's `{ error, code }` envelope is surfaced on `message`/`code`/`body`.
- `VersionConflictError` — `subgraphs.deploy()` with optimistic `expectedVersion` that no longer matches.

```ts
import { ApiError, VersionConflictError } from "@secondlayer/sdk";

try {
  await sl.subgraphs.deploy(spec);
} catch (err) {
  if (err instanceof VersionConflictError) {
    console.error(`expected ${err.expectedVersion}, server has ${err.currentVersion}`);
  } else if (err instanceof ApiError) {
    if (err.status === 401) await refreshApiKey();
    if (err.status === 429) await wait(Number(err.message.match(/\d+/)?.[0] ?? 1) * 1000);
    throw err;
  }
}
```

### Streams: `AuthError`, `RateLimitError`, `StreamsServerError`, `StreamsSignatureError`, `ValidationError`

Thrown by `sl.streams.*` (and the bare `createStreamsClient()`). They do **not** extend `ApiError`.

```ts
class AuthError extends Error {
  readonly status: 401;
}

class RateLimitError extends Error {
  readonly status: 429;
  readonly retryAfter?: string; // raw header value
}

class StreamsServerError extends Error {
  readonly status: number; // >= 500
  readonly body?: unknown;
}

class ValidationError extends Error {
  readonly status: number; // other 4xx
  readonly body?: unknown;
}

// Thrown only when `verify` is enabled and a response's X-Signature is
// missing or fails ed25519 verification.
class StreamsSignatureError extends Error {}
```

```ts
import { AuthError, RateLimitError } from "@secondlayer/sdk";

try {
  for await (const ev of sl.streams.events.stream()) handle(ev);
} catch (err) {
  if (err instanceof RateLimitError) {
    await wait(Number(err.retryAfter ?? "1") * 1000);
  } else if (err instanceof AuthError) {
    throw new Error("Bad API key");
  } else {
    throw err;
  }
}
```

---

## 9. Webhook verification

Validates the real Standard Webhooks delivery (`format: "standard-webhooks"` — the default). Pass the raw body and the request headers; the helper reads `webhook-id` / `webhook-timestamp` / `webhook-signature`, checks the timestamp is within `toleranceSeconds` (default 300), and HMAC-verifies a `v1` signature.

```ts
import { verifyWebhookSignature } from "@secondlayer/sdk";

verifyWebhookSignature(
  rawBody: string,                     // raw request body (NOT JSON.stringify(req.body))
  headers: WebhookHeaderInput,         // see below
  secret: string,                      // signing secret from subscriptions.create / rotateSecret
  toleranceSeconds?: number,           // default 300
): boolean
```

`headers` accepts:
- A plain object: `req.headers` from Node/Express. Header lookup is case-insensitive.
- A Fetch `Headers` instance: `req.headers` from Hono / Bun / Workers / Deno.
- A callback `(name) => string | null | undefined` for unusual frameworks.

Also exported: `StandardWebhooksHeaders` (the typed header shape) and `verifyStandardWebhooksHeaders` (the lower-level helper re-exported from `@secondlayer/shared/crypto/standard-webhooks` for advanced cases).

The signed string is `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC-SHA256 with the signing secret (base64-decoded after stripping the `whsec_` prefix). The helper checks every `v1` signature tuple in `webhook-signature` (space-separated; multi-version safe).

### Hono / Bun / Workers

```ts
import { Hono } from "hono";
import { verifyWebhookSignature } from "@secondlayer/sdk";

const app = new Hono();

app.post("/webhook", async (c) => {
  const raw = await c.req.text();
  if (!verifyWebhookSignature(raw, c.req.raw.headers, process.env.SIGNING_SECRET!)) {
    return c.text("Invalid signature", 401);
  }
  const { type, timestamp, data } = JSON.parse(raw);
  // type === "<subgraph>.<table>.created", data === the row
  return c.body(null, 204);
});
```

### Express

```ts
import express from "express";
import { verifyWebhookSignature } from "@secondlayer/sdk";

const app = express();

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const raw = (req.body as Buffer).toString("utf8");
    if (!verifyWebhookSignature(raw, req.headers, process.env.SIGNING_SECRET!)) {
      return res.status(401).end();
    }
    const { type, timestamp, data } = JSON.parse(raw);
    res.status(204).end();
  },
);
```

`verifyWebhookSignature` returns `false` (never throws) when any header is missing, the timestamp is outside `toleranceSeconds`, or no `v1` signature matches. Treat any `false` as a 401 — do not retry locally.

> **Use `webhook-id` for dedup.** It's stable across retries — store it and ignore duplicates. The delivery may retry up to 7 times over 72 hours.
