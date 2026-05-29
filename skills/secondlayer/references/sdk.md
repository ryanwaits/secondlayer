# `@secondlayer/sdk` — TypeScript Reference

Source of truth: `packages/sdk/src/`. Function signatures below are copied verbatim — match them exactly when generating code.

**Auth model (open beta):** all `sl.streams.*`, `sl.index.*`, and read-only `sl.subgraphs.*` (list/get/openapi/schema/markdown/queryTable/queryTableCount/gaps/getSource) are **anonymous** — no API key required. Write paths (`subgraphs.deploy/reindex/backfill/stop/delete/bundle`, all `sl.subscriptions.*`) **require `apiKey`**.

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

`SecondLayer` exposes four resource clients:

```ts
sl.streams        // StreamsClient
sl.index          // Index
sl.subgraphs      // Subgraphs
sl.subscriptions  // Subscriptions
```

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
  DecodedFtTransfer,
  DecodedNftTransfer,
  FtTransferEvent,
  NftTransferEvent,
} from "@secondlayer/sdk/streams";

const streams = createStreamsClient({ apiKey: "" }); // anonymous reads OK
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

```ts
export type StreamsEvent = {
  cursor: string;
  block_height: number;
  block_hash: string;
  burn_block_height: number;
  tx_id: string;
  tx_index: number;
  event_index: number;
  event_type: StreamsEventType;
  contract_id: string | null;
  payload: Record<string, unknown>;
  ts: string;
};

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
};
```

```ts
const tip = await sl.streams.tip();
console.log(`At block ${tip.block_height}, lag ${tip.lag_seconds}s`);
```

### `sl.streams.events.list(params?)`

```ts
type StreamsEventsListParams = {
  cursor?: string | null;
  fromHeight?: number;
  toHeight?: number;
  types?: readonly StreamsEventType[];
  contractId?: string;
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

Use for indexers/ETL that own cursor checkpointing. Return the next checkpoint from `onBatch`.

```ts
type StreamsEventsConsumeParams = {
  fromCursor?: string | null;
  mode?: "tail" | "bounded";        // default "tail"
  types?: readonly StreamsEventType[];
  contractId?: string;
  batchSize?: number;               // default 100
  onBatch: (
    events: StreamsEvent[],
    envelope: StreamsEventsEnvelope,
  ) => Promise<string | null | undefined> | string | null | undefined;
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

```ts
let checkpoint = await loadCheckpoint(); // your durable store

await sl.streams.events.consume({
  fromCursor: checkpoint,
  types: ["ft_transfer", "nft_transfer"],
  batchSize: 250,
  mode: "tail",
  async onBatch(events, envelope) {
    for (const ev of events) await handle(ev);
    await saveCheckpoint(envelope.next_cursor);
    return envelope.next_cursor; // continue from here
  },
});
```

`mode: "bounded"` exits on the first empty page — useful for backfills. `signal` lets you abort cleanly on shutdown.

### `sl.streams.events.stream(params?)` — async iterator

For live watchers/processors that don't need explicit checkpointing.

```ts
type StreamsEventsStreamParams = {
  fromCursor?: string | null;
  types?: readonly StreamsEventType[];
  contractId?: string;
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

```ts
import { Datasets } from "@secondlayer/sdk";
const ds = new Datasets({ baseUrl: "https://api.secondlayer.tools" });

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

## 6. `sl.subgraphs`

Read methods are anonymous. **Write methods (`deploy`, `reindex`, `backfill`, `stop`, `delete`, `bundle`) require `apiKey`.**

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

interface SubscriptionSummary {
  id: string;
  name: string;
  status: SubscriptionStatus;
  subgraphName: string;
  tableName: string;
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
  authConfig: Record<string, unknown>;
  maxRetries: number;
  timeoutMs: number;
  concurrency: number;
  circuitFailures: number;
  circuitOpenedAt: string | null;
  lastError: string | null;
}
```

### `list()`, `get(id)`

```ts
list(): Promise<{ data: SubscriptionSummary[] }>
get(id: string): Promise<SubscriptionDetail>
```

### `create(input)`

```ts
interface CreateSubscriptionRequest {
  name: string;
  subgraphName: string;
  tableName: string;
  url: string;                              // must start with http(s)://
  filter?: SubscriptionFilter;
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

### Streams: `AuthError`, `RateLimitError`, `StreamsServerError`, `ValidationError`

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
