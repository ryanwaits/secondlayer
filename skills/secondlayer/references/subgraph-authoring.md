# Subgraph Authoring (`@secondlayer/subgraphs`)

Reference for writing `subgraphs/<name>.ts` files. Every type signature below is copied verbatim from `packages/subgraphs/src/types.ts` — do not paraphrase when generating code.

---

## 1. Mental Model

A subgraph is a single TypeScript file that exports `defineSubgraph({ name, sources, schema, handlers })` as its default export. `sources` is a named object of event filters; `schema` declares Postgres tables; `handlers` are functions keyed by source name that run once per matching event (batched per block). Secondlayer materializes the schema into Postgres, runs your handlers against the Stacks event stream (live + backfill), and exposes each table as a REST endpoint at `/api/subgraphs/<name>/<table>`.

Deploy with `sl subgraphs deploy <file>`; the runtime owns ingestion, retries, and gap handling.

---

## 2. The `SubgraphDefinition` Shape

Verbatim from `packages/subgraphs/src/types.ts`:

```ts
export interface SubgraphDefinition {
  /** Unique subgraph name (lowercase, alphanumeric + hyphens) */
  name: string;
  /** Semantic version */
  version?: string;
  /** Human description */
  description?: string;
  /** Block height to start indexing from (default: 1) */
  startBlock?: number;
  /** Named source filters — keys become handler keys */
  sources: Record<string, SubgraphFilter>;
  /** Tables in this subgraph */
  schema: SubgraphSchema;
  /** Handler functions — keys must match source names (or "*" for catch-all) */
  handlers: Record<string, SubgraphHandler>;
}
```

Use `defineSubgraph()` (an identity function that preserves schema literal types for inference):

```ts
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "my-subgraph",
  version: "1.0.0",
  description: "What it tracks",
  startBlock: 100_000,
  sources: { /* ... */ },
  schema: { /* ... */ },
  handlers: { /* ... */ },
});
```

`SubgraphSchema` is `Record<string, SubgraphTable>`.

`SubgraphFilter` is a discriminated union of 13 filter types, all keyed on `type` (see §3).

`SubgraphHandler`:

```ts
export type SubgraphHandler = (
  event: Record<string, unknown>,
  ctx: SubgraphContext,
) => Promise<void> | void;
```

---

## 3. Sources (Event Filters) — All 13 Types

`sources` is a **named object** (`Record<string, SubgraphFilter>`). The key becomes the handler key:

```ts
sources: {
  transfer: { type: "ft_transfer", assetIdentifier: "SP...::usda" },
},
handlers: {
  transfer: (event, ctx) => { /* ... */ },
}
```

### Filter ↔ Event Payload Reference

The `event` arg the handler receives carries the decoded payload for that filter type. Below: filter interface (verbatim from `src/types.ts`) + the payload your handler will receive (from `src/triggers/index.ts`).

All event payloads include this shared `tx` field:

```ts
export interface TxMeta {
  txId: string;
  sender: string;
  blockHeight: number;
  blockTime: number;
}
```

---

### 3.1 `stx_transfer`

**Filter:**

```ts
export interface StxTransferFilter {
  type: "stx_transfer";
  sender?: string;
  recipient?: string;
  minAmount?: bigint;
  maxAmount?: bigint;
}
```

**Event payload:**

```ts
export interface StxTransferEvent {
  sender: string;
  recipient: string;
  amount: bigint;
  memo: string | null;
  tx: TxMeta;
}
```

Triggers on any native STX transfer event emitted in a block.

---

### 3.2 `stx_mint`

**Filter:**

```ts
export interface StxMintFilter {
  type: "stx_mint";
  recipient?: string;
  minAmount?: bigint;
}
```

**Event payload:**

```ts
export interface StxMintEvent {
  recipient: string;
  amount: bigint;
  tx: TxMeta;
}
```

Triggers on STX minting events (e.g., coinbase, PoX rewards).

---

### 3.3 `stx_burn`

**Filter:**

```ts
export interface StxBurnFilter {
  type: "stx_burn";
  sender?: string;
  minAmount?: bigint;
}
```

**Event payload:**

```ts
export interface StxBurnEvent {
  sender: string;
  amount: bigint;
  tx: TxMeta;
}
```

Triggers on STX burn events.

---

### 3.4 `stx_lock`

**Filter:**

```ts
export interface StxLockFilter {
  type: "stx_lock";
  lockedAddress?: string;
  minAmount?: bigint;
}
```

**Event payload:**

```ts
export interface StxLockEvent {
  lockedAddress: string;
  amount: bigint;
  unlockHeight: number;
  tx: TxMeta;
}
```

Triggers on STX lock events (PoX stacking).

---

### 3.5 `ft_transfer`

**Filter:**

```ts
export interface FtTransferFilter {
  type: "ft_transfer";
  assetIdentifier?: string;
  sender?: string;
  recipient?: string;
  minAmount?: bigint;
}
```

**Event payload:**

```ts
export interface FtTransferEvent {
  assetIdentifier: string;
  sender: string;
  recipient: string;
  amount: bigint;
  tx: TxMeta;
}
```

Triggers on SIP-010 fungible token transfers. `assetIdentifier` example: `SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.usda-token::usda`.

---

### 3.6 `ft_mint`

**Filter:**

```ts
export interface FtMintFilter {
  type: "ft_mint";
  assetIdentifier?: string;
  recipient?: string;
  minAmount?: bigint;
}
```

**Event payload:**

```ts
export interface FtMintEvent {
  assetIdentifier: string;
  recipient: string;
  amount: bigint;
  tx: TxMeta;
}
```

---

### 3.7 `ft_burn`

**Filter:**

```ts
export interface FtBurnFilter {
  type: "ft_burn";
  assetIdentifier?: string;
  sender?: string;
  minAmount?: bigint;
}
```

**Event payload:**

```ts
export interface FtBurnEvent {
  assetIdentifier: string;
  sender: string;
  amount: bigint;
  tx: TxMeta;
}
```

---

### 3.8 `nft_transfer`

**Filter:**

```ts
export interface NftTransferFilter {
  type: "nft_transfer";
  assetIdentifier?: string;
  sender?: string;
  recipient?: string;
}
```

**Event payload:**

```ts
export interface NftTransferEvent {
  assetIdentifier: string;
  sender: string;
  recipient: string;
  tokenId: string;
  tx: TxMeta;
}
```

`tokenId` is the stringified Clarity value of the NFT identifier (uint string, tuple repr, etc.).

---

### 3.9 `nft_mint`

**Filter:**

```ts
export interface NftMintFilter {
  type: "nft_mint";
  assetIdentifier?: string;
  recipient?: string;
}
```

**Event payload:**

```ts
export interface NftMintEvent {
  assetIdentifier: string;
  recipient: string;
  tokenId: string;
  tx: TxMeta;
}
```

---

### 3.10 `nft_burn`

**Filter:**

```ts
export interface NftBurnFilter {
  type: "nft_burn";
  assetIdentifier?: string;
  sender?: string;
}
```

**Event payload:**

```ts
export interface NftBurnEvent {
  assetIdentifier: string;
  sender: string;
  tokenId: string;
  tx: TxMeta;
}
```

---

### 3.11 `contract_call`

**Filter:**

```ts
export interface ContractCallFilter {
  type: "contract_call";
  contractId?: string;
  functionName?: string;
  caller?: string;
  /** ABI for typed event.args. If omitted, auto-fetched at deploy time. */
  abi?: Record<string, unknown>;
}
```

**Event payload (per `src/types.ts` — `ContractCallEvent`):**

```ts
export interface ContractCallEvent {
  type: "contract_call";
  /** Transaction sender (the principal who signed the tx). Always non-null. */
  sender: string;
  contractId: string;
  functionName: string;
  /** Positional decoded Clarity values — order matches the ABI parameter list. */
  args: unknown[];
  /** Decoded return value from the contract function, or null. */
  result: unknown;
  /** Raw hex-encoded result value. */
  resultHex: string | null;
  /** Transaction metadata. */
  tx: {
    txId: string;
    sender: string;
    type: string;
    status: string;
    contractId: string | null;
    functionName: string | null;
  };
}
```

`args` is a **positional array** of decoded Clarity values in ABI parameter order. Bigints are `bigint`, buffers are `Uint8Array`, principals are strings, tuples are `Record<string, unknown>`. Guard with `args.length > 0` when reading pre-Nakamoto history.

Example destructuring (pox-4 `stack-stx`: `amount-ustx uint, pox-addr tuple, start-burn-ht uint, lock-period uint`):

```ts
const [amountUstx, , , lockPeriod] = event.args;
```

---

### 3.12 `contract_deploy`

**Filter:**

```ts
export interface ContractDeployFilter {
  type: "contract_deploy";
  deployer?: string;
  contractName?: string;
}
```

**Event payload:**

```ts
export interface ContractDeployEvent {
  contractId: string;
  deployer: string;
  contractName: string;
  tx: TxMeta;
}
```

---

### 3.13 `print_event`

**Filter:**

```ts
export interface PrintEventFilter {
  type: "print_event";
  contractId?: string;
  topic?: string;
}
```

**Event payload:**

```ts
export interface PrintEventEvent {
  contractId: string;
  topic: string | null;
  value: unknown;
  tx: TxMeta;
}
```

`topic` is the conventional top-level `topic` string in a printed tuple (e.g. `"swap"`, `"deposit"`). `value` is the fully decoded Clarity value (tuple, list, scalar — depends on what the contract printed).

---

## 4. Schema

`SubgraphSchema` is `Record<string, SubgraphTable>`. Each table:

```ts
export interface SubgraphTable {
  columns: Record<string, SubgraphColumn>;
  /** Composite indexes (each entry is an array of column names) */
  indexes?: string[][];
  /** Unique key constraints (each entry is an array of column names). Required for upsert. */
  uniqueKeys?: string[][];
}
```

### Columns

```ts
export interface SubgraphColumn {
  type: ColumnType;
  nullable?: boolean;
  indexed?: boolean;
  search?: boolean;
  default?: string | number | boolean;
}
```

### `ColumnType` — supported types

```ts
export type ColumnType =
  | "text"
  | "uint"
  | "int"
  | "principal"
  | "boolean"
  | "timestamp"
  | "jsonb";
```

TypeScript mapping (from `src/infer.ts`):

| Column type  | TS type at handler input/output | Postgres type     |
|--------------|---------------------------------|-------------------|
| `text`       | `string`                        | `TEXT`            |
| `principal`  | `string`                        | `TEXT`            |
| `timestamp`  | `string` (ISO 8601)             | `TIMESTAMPTZ`     |
| `uint`       | `bigint`                        | `NUMERIC`         |
| `int`        | `bigint`                        | `NUMERIC`         |
| `boolean`    | `boolean`                       | `BOOLEAN`         |
| `jsonb`      | `Record<string, unknown>`       | `JSONB`           |

### Column flags

- `nullable: true` — column accepts NULL; inferred TS type becomes `T | null`.
- `indexed: true` — single-column B-tree index for fast equality/range filters.
- `search: true` — trigram GIN index (`pg_trgm`) for fuzzy `_search` query param. Use on text columns the user will substring/fuzzy-match.
- `default: "..."` / `0` / `false` — Postgres default for the column.

### Composite indexes

```ts
indexes: [
  ["sender", "block_height"],
  ["asset_identifier", "holder"],
]
```

### `uniqueKeys` — required for `ctx.upsert`

```ts
uniqueKeys: [["asset_identifier", "holder"]]
```

If you call `ctx.upsert(table, key, row)` and the `key` columns don't match a `uniqueKeys` entry, the runtime logs a warning and falls back to a non-atomic insert. **Always declare `uniqueKeys` for any table you upsert into.**

### Auto-added system columns

Every table automatically gets:

| Column          | TS shape on row reads | Notes                                       |
|-----------------|-----------------------|---------------------------------------------|
| `_id`           | `string`              | Server-generated row id.                    |
| `_block_height` | `bigint`              | Set from `ctx.block.height` on insert.      |
| `_tx_id`        | `string`              | Set from `ctx.tx.txId` on insert.           |
| `_created_at`   | `string` (ISO 8601)   | Server insert timestamp.                    |

`SystemRow` (`src/infer.ts`) — the camelCase shape included in inferred rows:

```ts
export interface SystemRow {
  _id: string;
  _blockHeight: bigint;
  _txId: string;
  _createdAt: string;
}
```

**Don't** declare `_block_height` / `_tx_id` columns yourself — the runtime adds them.

---

## 5. Handlers

```ts
export type SubgraphHandler = (
  event: Record<string, unknown>,
  ctx: SubgraphContext,
) => Promise<void> | void;
```

Rules:

- Handler **key must equal a source key** in `sources`, or be `"*"` (catch-all that fires for every matched event).
- Runs **once per matched event**. Writes are batched and flushed atomically at the end of the block.
- Can be sync or `async`. Use `async` when calling `ctx.findOne`, `ctx.findMany`, `ctx.count`, etc. — those return promises.
- The `event` arg is typed as `Record<string, unknown>` at the runtime contract; cast to the concrete payload (e.g. `FtTransferEvent`) or use typed triggers (§7) for inference.

Example:

```ts
handlers: {
  transfer: async (event, ctx) => {
    const e = event as { assetIdentifier: string; sender: string; recipient: string; amount: bigint };
    ctx.insert("transfers", {
      asset_identifier: e.assetIdentifier,
      sender: e.sender,
      recipient: e.recipient,
      amount: e.amount,
    });
  },
  "*": (event, ctx) => {
    // catch-all — fires for every matched event of any source
  },
}
```

---

## 6. The `ctx` Object

```ts
export interface SubgraphContext {
  block: {
    height: number;
    hash: string;
    timestamp: number;
    burnBlockHeight: number;
  };
  tx: TxMeta;
  insert(table: string, row: Record<string, unknown>): void;
  update(
    table: string,
    where: Record<string, unknown>,
    set: Record<string, unknown>,
  ): void;
  upsert(
    table: string,
    key: Record<string, unknown>,
    row: Record<string, unknown>,
  ): void;
  delete(table: string, where: Record<string, unknown>): void;
  /** Partial update — sets only specified fields, preserves others */
  patch(
    table: string,
    where: Record<string, unknown>,
    set: Record<string, unknown>,
  ): void;
  /** Find-then-merge-or-insert. Values can be functions: (existing) => newValue */
  patchOrInsert(
    table: string,
    key: Record<string, unknown>,
    row: Record<string, ComputedValue>,
  ): Promise<void>;
  findOne(
    table: string,
    where: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  findMany(
    table: string,
    where: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]>;
  /** Format a bigint amount with decimal places */
  formatUnits(value: bigint, decimals: number): string;
  /** Count rows matching filter */
  count(table: string, where?: Record<string, unknown>): Promise<number>;
  /** Sum a numeric column */
  sum(
    table: string,
    column: string,
    where?: Record<string, unknown>,
  ): Promise<bigint>;
  /** Min of a numeric column */
  min(
    table: string,
    column: string,
    where?: Record<string, unknown>,
  ): Promise<bigint | null>;
  /** Max of a numeric column */
  max(
    table: string,
    column: string,
    where?: Record<string, unknown>,
  ): Promise<bigint | null>;
  /** Count distinct values in a column */
  countDistinct(
    table: string,
    column: string,
    where?: Record<string, unknown>,
  ): Promise<number>;
}
```

Plus the related type:

```ts
export type ComputedValue =
  | RowValue
  | ((existing: Record<string, unknown> | null) => unknown);
```

### `ctx.block` and `ctx.tx`

`ctx.block`:

```ts
{ height: number; hash: string; timestamp: number; burnBlockHeight: number }
```

`ctx.tx` (`TxMeta` from `src/types.ts`):

```ts
{
  txId: string;
  sender: string;
  type: string;     // e.g. "contract_call", "smart_contract", "token_transfer"
  status: string;   // e.g. "success", "abort_by_response"
  contractId?: string | null;
  functionName?: string | null;
}
```

### Writes — when to use which

| Method            | Sync/async  | Use when                                                                 |
|-------------------|-------------|--------------------------------------------------------------------------|
| `insert`          | sync        | Append-only event log (one row per event).                               |
| `update`          | sync        | You know the row exists and want to replace specific fields by `where`.  |
| `upsert`          | sync        | Stateful row keyed by `uniqueKeys` — replace whole row (e.g. balances). Requires matching `uniqueKeys` entry. |
| `delete`          | sync        | Remove rows matching `where`.                                            |
| `patch`           | sync        | Alias for `update` — partial update preserving other fields.             |
| `patchOrInsert`   | **async**   | Need `(existing) => newValue` semantics (reads first). Slower — prefer plain `upsert` when you can compute the new row without reading. |

Writes are queued; they flush atomically at the end of the block.

### Reads — execute immediately

- `findOne(table, where)` → `Promise<row | null>`
- `findMany(table, where)` → `Promise<row[]>`
- `count(table, where?)` → `Promise<number>`
- `sum(table, column, where?)` → `Promise<bigint>`
- `min(table, column, where?)` → `Promise<bigint | null>`
- `max(table, column, where?)` → `Promise<bigint | null>`
- `countDistinct(table, column, where?)` → `Promise<number>`

Reads see **pre-flush state** — writes queued earlier in the same block aren't visible to reads.

### Utility

`ctx.formatUnits(value: bigint, decimals: number): string` — convert a raw `bigint` amount to a fixed-decimal string for display (e.g. `formatUnits(123_456_789n, 8)` → `"1.23456789"`).

---

## 7. Typed Triggers (`on.*`)

`@secondlayer/subgraphs/triggers` exports phantom-typed event-trigger builders for type inference at the consumer level. The runtime shape is identical to a plain filter; the phantom `__event` carries the payload type.

```ts
import { on, type EventOf } from "@secondlayer/subgraphs/triggers";

const trigger = on.ftTransfer({ assetIdentifier: "SP3K8...usda-token::usda" });
type Event = EventOf<typeof trigger>; // → FtTransferEvent
```

### All 13 helpers

```ts
export interface TriggerHelpers {
  stxTransfer:    (f?: Omit<StxTransferFilter,    "type">) => TypedEventTrigger<StxTransferEvent>;
  stxMint:        (f?: Omit<StxMintFilter,        "type">) => TypedEventTrigger<StxMintEvent>;
  stxBurn:        (f?: Omit<StxBurnFilter,        "type">) => TypedEventTrigger<StxBurnEvent>;
  stxLock:        (f?: Omit<StxLockFilter,        "type">) => TypedEventTrigger<StxLockEvent>;
  ftTransfer:     (f?: Omit<FtTransferFilter,     "type">) => TypedEventTrigger<FtTransferEvent>;
  ftMint:         (f?: Omit<FtMintFilter,         "type">) => TypedEventTrigger<FtMintEvent>;
  ftBurn:         (f?: Omit<FtBurnFilter,         "type">) => TypedEventTrigger<FtBurnEvent>;
  nftTransfer:    (f?: Omit<NftTransferFilter,    "type">) => TypedEventTrigger<NftTransferEvent>;
  nftMint:        (f?: Omit<NftMintFilter,        "type">) => TypedEventTrigger<NftMintEvent>;
  nftBurn:        (f?: Omit<NftBurnFilter,        "type">) => TypedEventTrigger<NftBurnEvent>;
  contractCall:   (f?: Omit<ContractCallFilter,   "type">) => TypedEventTrigger<ContractCallEvent>;
  contractDeploy: (f?: Omit<ContractDeployFilter, "type">) => TypedEventTrigger<ContractDeployEvent>;
  printEvent:     (f?: Omit<PrintEventFilter,     "type">) => TypedEventTrigger<PrintEventEvent>;
}
```

```ts
export type EventOf<T> = T extends TypedEventTrigger<infer E> ? E : never;
```

**Note:** triggers are phantom-typed — they're used for type inference at consumer sites (Subscriptions API). For `defineSubgraph` sources you can either pass plain `{ type: "...", ... }` filters or use the triggers' runtime shape; the inference value-add is at the handler payload typing layer in subscription definitions.

---

## 8. Type Inference for Query Clients

`packages/subgraphs/src/infer.ts` exports inference utilities. The `defineSubgraph` identity function preserves your `schema` as a literal type, which feeds the inference chain:

```ts
export type ColumnToTS<T extends string> = T extends "uint" | "int"
  ? bigint
  : T extends "text" | "principal" | "timestamp"
    ? string
    : T extends "boolean"
      ? boolean
      : T extends "jsonb"
        ? Record<string, unknown>
        : unknown;

export type InferColumnType<C extends SubgraphColumn> =
  C["type"] extends ColumnType
    ? C["nullable"] extends true
      ? ColumnToTS<C["type"]> | null
      : ColumnToTS<C["type"]>
    : unknown;

export type InferTableRow<T extends SubgraphTable> = SystemRow & {
  [K in keyof T["columns"]]: InferColumnType<T["columns"][K]>;
};

export type InferSubgraphClient<T> = T extends { schema: infer S }
  ? {
      [K in keyof S]: S[K] extends SubgraphTable
        ? SubgraphTableClient<InferTableRow<S[K]>>
        : never;
    }
  : never;
```

Each table client:

```ts
export interface SubgraphTableClient<TRow> {
  findMany(options?: FindManyOptions<TRow>): Promise<TRow[]>;
  count(where?: WhereInput<TRow> & SystemWhereAliases): Promise<number>;
}

export interface FindManyOptions<TRow> {
  where?: WhereInput<TRow> & SystemWhereAliases;
  orderBy?: { [K in keyof TRow]?: "asc" | "desc" } & SystemOrderByAliases;
  limit?: number;
  offset?: number;
  fields?: (keyof TRow & string)[];
}

export type ComparisonFilter<T> = {
  eq?: T; neq?: T; gt?: T; gte?: T; lt?: T; lte?: T;
};

export type WhereInput<TRow> = {
  [K in keyof TRow]?: TRow[K] | ComparisonFilter<TRow[K]>;
};
```

`SystemWhereAliases` / `SystemOrderByAliases` accept either underscore (`_blockHeight`) or no-prefix (`blockHeight`) forms.

### Using `sl.subgraphs.typed(definition)`

```ts
import { SecondLayer } from "@secondlayer/sdk";
import mySubgraph from "./subgraphs/my-subgraph.ts";

const sl = new SecondLayer({ apiKey: process.env.SECONDLAYER_KEY });
const client = sl.subgraphs.typed(mySubgraph);

// Fully typed against your schema literal:
const rows = await client.transfers.findMany({
  where: {
    sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    amount: { gt: 1_000_000n },
  },
  orderBy: { blockHeight: "desc" },
  limit: 50,
});
// rows: InferTableRow<typeof mySubgraph.schema.transfers>[]

const total = await client.transfers.count({ sender: "SP..." });
```

Or with the standalone helper:

```ts
import { getSubgraph } from "@secondlayer/sdk";
const client = getSubgraph(mySubgraph, { apiKey: "sl_..." });
```

---

## 9. Common Patterns

### 9.1 SIP-010 transfer indexer with per-holder balance upsert

Adapted from `tmp/preflight-cli/subgraphs/preflight-sbtc.ts`. Mirrors the Foundation Datasets sBTC token-events shape but works for any SIP-010 token.

```ts
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "sip010-balances",
  version: "1.0.0",
  description: "Per-token balance tracking for any SIP-010 asset",
  sources: {
    transfer: { type: "ft_transfer" },
    mint:     { type: "ft_mint" },
    burn:     { type: "ft_burn" },
  },
  schema: {
    balances: {
      columns: {
        asset_identifier: { type: "text", indexed: true, search: true },
        holder:           { type: "principal", indexed: true, search: true },
        amount:           { type: "uint" },
      },
      uniqueKeys: [["asset_identifier", "holder"]],
    },
  },
  handlers: {
    transfer: async (event, ctx) => {
      const amount = BigInt((event as { amount: bigint }).amount ?? 0n);
      const e = event as { assetIdentifier: string; sender?: string; recipient?: string };
      if (e.sender)    await adjust(ctx, e.assetIdentifier, e.sender, -amount);
      if (e.recipient) await adjust(ctx, e.assetIdentifier, e.recipient, amount);
    },
    mint: async (event, ctx) => {
      const e = event as { assetIdentifier: string; recipient: string; amount: bigint };
      await adjust(ctx, e.assetIdentifier, e.recipient, BigInt(e.amount ?? 0n));
    },
    burn: async (event, ctx) => {
      const e = event as { assetIdentifier: string; sender: string; amount: bigint };
      await adjust(ctx, e.assetIdentifier, e.sender, -BigInt(e.amount ?? 0n));
    },
  },
});

async function adjust(
  // biome-ignore lint/suspicious/noExplicitAny: subgraph runtime ctx
  ctx: any,
  assetIdentifier: string,
  holder: string,
  delta: bigint,
): Promise<void> {
  const existing = await ctx.findOne("balances", { asset_identifier: assetIdentifier, holder });
  const current = existing ? BigInt(existing.amount) : 0n;
  ctx.upsert(
    "balances",
    { asset_identifier: assetIdentifier, holder },
    { asset_identifier: assetIdentifier, holder, amount: current + delta },
  );
}
```

### 9.2 Contract deployment tracker

Verbatim from `packages/subgraphs/examples/contract-deployments.ts`:

```ts
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "contract-deployments",
  version: "1.0.0",
  description: "Tracks all smart contract deployments on Stacks",
  sources: { deploy: { type: "contract_deploy" } },
  schema: {
    contracts: {
      columns: {
        contract_id:   { type: "text", search: true, indexed: true },
        name:          { type: "text", search: true },
        deployer:      { type: "principal", indexed: true },
        deploy_block:  { type: "uint" },
        deploy_tx_id:  { type: "text" },
      },
      uniqueKeys: [["contract_id"]],
    },
  },
  handlers: {
    deploy: async (event, ctx) => {
      const tx = (event as { tx?: { contractId?: string } }).tx;
      const contractId = tx?.contractId ?? ctx.tx.sender;
      const name = contractId.includes(".") ? contractId.split(".")[1] : contractId;
      ctx.upsert(
        "contracts",
        { contract_id: contractId },
        {
          contract_id: contractId,
          name,
          deployer: ctx.tx.sender,
          deploy_block: ctx.block.height,
          deploy_tx_id: ctx.tx.txId,
        },
      );
    },
  },
});
```

### 9.3 Print-event indexer with topic filter

Adapted from `bench/subgraphs/sbtc-flows-bench.ts`. Filters print events from a specific contract on a topic; useful for indexing DEX swaps, vault operations, etc.

```ts
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "alex-swaps",
  version: "1.0.0",
  description: "ALEX AMM swap events",
  sources: {
    swap: {
      type: "print_event",
      contractId: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01",
      topic: "swap",
    },
  },
  schema: {
    swaps: {
      columns: {
        sender:   { type: "principal", indexed: true },
        token_x:  { type: "text", indexed: true },
        token_y:  { type: "text", indexed: true },
        amount_x: { type: "uint" },
        amount_y: { type: "uint" },
      },
      indexes: [["sender", "token_x"]],
    },
  },
  handlers: {
    swap: (event, ctx) => {
      const value = (event as { value: Record<string, unknown> }).value;
      ctx.insert("swaps", {
        sender:   ctx.tx.sender,
        token_x:  value["token-x"],
        token_y:  value["token-y"],
        amount_x: value.dx,
        amount_y: value.dy,
      });
    },
  },
});
```

### 9.4 sBTC deposit tracker

Tracks completed deposits from the sBTC registry contract.

```ts
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "sbtc-deposits",
  version: "1.0.0",
  description: "Completed sBTC deposits from sbtc-registry print events",
  startBlock: 328_312,
  sources: {
    registry: {
      type: "print_event",
      contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
      topic: "completed-deposit",
    },
  },
  schema: {
    deposits: {
      columns: {
        bitcoin_txid:    { type: "text", indexed: true, search: true },
        bitcoin_vout:    { type: "uint" },
        recipient:       { type: "principal", indexed: true, search: true },
        amount:          { type: "uint" },
        sweep_block_hash:{ type: "text", nullable: true },
        sweep_txid:      { type: "text", nullable: true },
      },
      uniqueKeys: [["bitcoin_txid", "bitcoin_vout"]],
    },
  },
  handlers: {
    registry: (event, ctx) => {
      const value = (event as { value: Record<string, unknown> }).value;
      ctx.upsert(
        "deposits",
        { bitcoin_txid: value["bitcoin-txid"], bitcoin_vout: value["output-index"] },
        {
          bitcoin_txid:     value["bitcoin-txid"],
          bitcoin_vout:     value["output-index"],
          recipient:        value.recipient,
          amount:           value.amount,
          sweep_block_hash: value["sweep-block-hash"] ?? null,
          sweep_txid:       value["sweep-txid"] ?? null,
        },
      );
    },
  },
});
```

---

## 10. Validation

Import from `@secondlayer/subgraphs`:

```ts
import { validateSubgraphDefinition } from "@secondlayer/subgraphs";

validateSubgraphDefinition(def); // throws ZodError on invalid input
```

### Naming rules (`SubgraphNameSchema`)

- 1–63 characters
- Must match `/^[a-z][a-z0-9-]*$/`:
  - Starts with a lowercase letter
  - Lowercase alphanumeric and hyphens only

### Other validation enforced

- `sources` must have at least one entry.
- `schema` must have at least one table.
- Every table must have at least one column.
- `column.type` must be one of the seven `ColumnType` enum values.
- Filter `type` must be one of the 13 supported filter types.
- `startBlock` must be a non-negative integer.

The CLI runs validation on `sl subgraphs deploy` — bad definitions never reach the runtime.

---

## 11. Don't-Do List

- **Don't use array sources or `"contract::event"` handler names** — that was the old shape. Sources are a named object `Record<string, SubgraphFilter>` and handlers are keyed by source name (or `"*"`).
- **Don't omit `uniqueKeys` if you call `upsert`** — the runtime falls back to a non-atomic insert with a warning. For correctness, always declare `uniqueKeys: [[...]]` matching the upsert key.
- **Don't use `number` for amounts** — Stacks amounts are 128-bit. Use `bigint` literals (`1_000_000n`) and the `uint` column type.
- **Don't hand-add `_block_height` / `_tx_id` columns** — they're auto-added on every insert. Declaring them yourself will conflict.
- **Don't reach for `patchOrInsert` if a plain `upsert` works** — `patchOrInsert` is async (it reads existing first). Use it only when you need `(existing) => newValue` merge semantics; otherwise compute the new row inline and call sync `upsert`.
- **Don't assume `event` is strongly typed** — the runtime contract is `Record<string, unknown>`. Cast to the concrete payload (e.g. `FtTransferEvent`) or use typed triggers at the subscription layer.
- **Don't call `findOne`/`findMany` and expect to see writes from earlier in the same block** — reads return pre-flush state. If you need running totals within a block, accumulate in handler-local state or use `patchOrInsert` with a merge function.
- **Don't put complex business logic in `"*"` catch-all handlers without a discriminator** — `event` shape varies by source. Inspect `event.type` or branch on the source that matched.
