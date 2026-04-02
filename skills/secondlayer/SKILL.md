---
name: secondlayer
description: Install, configure, and build on Second Layer — a Stacks blockchain
  indexing platform. Use this skill when creating streams (real-time event delivery),
  scaffolding/deploying subgraphs (custom indexers), querying indexed data, or managing
  API keys. Triggers on tasks involving Stacks blockchain data, streams,
  custom indexers, blockchain event filtering, or the `secondlayer` CLI (`sl` shorthand).
license: MIT
metadata:
  author: secondlayer
  version: "0.1.0"
---

# Second Layer

Stacks blockchain indexing platform. Two primitives:

| | Streams | Subgraphs |
|--|---------|-----------|
| **Model** | Push — delivers matching events to your endpoint | Pull — indexes into SQL tables you query via REST |
| **Use when** | Real-time reactions (alerts, bots, pipelines) | Historical queries (dashboards, APIs, analytics) |
| **Define with** | JSON config file | TypeScript (defineSubgraph + handlers) |
| **State** | Stateless delivery | Stateful (persisted tables) |

## Install & Auth

```bash
npm install -g @secondlayer/cli
secondlayer auth login                    # opens browser, saves token
secondlayer auth status                   # verify auth
```

For SDK usage (programmatic access):
```bash
npm install @secondlayer/sdk
```
```typescript
import { SecondLayer } from "@secondlayer/sdk";
const sl = new SecondLayer({ apiKey: "sl_live_..." });
```

### API key management

```bash
secondlayer auth keys list                # list keys
secondlayer auth keys create              # create new key
secondlayer auth keys revoke <id>         # revoke key
secondlayer auth keys rotate              # rotate active key
```

---

## Streams

Streams deliver matching blockchain events to an endpoint URL in real-time.

### Create a stream

**Step 1**: Generate config template:
```bash
secondlayer streams new my-stream -o streams/my-stream.json
```

**Step 2**: Edit the JSON — set `endpointUrl` and `filters`, then register:
```bash
secondlayer streams register streams/my-stream.json
```
Save the `signingSecret` from the output — it's shown only once.

**SDK alternative** (single step):
```typescript
const { stream, signingSecret } = await sl.streams.create({
  name: "stx-transfers",
  endpointUrl: "https://example.com/receive",
  filters: [{ type: "stx_transfer", minAmount: 1000000 }],
  options: { maxRetries: 5, timeoutMs: 10000 },
});
```

### Filters

Every stream needs at least one filter. Common patterns:

```typescript
// STX transfers over 100 STX
{ type: "stx_transfer", minAmount: 100000000 }

// Calls to a specific contract function
{ type: "contract_call", contractId: "SP102...amm-pool-v2-01", functionName: "swap-helper" }

// Smart contract events
{ type: "print_event", contractId: "SP102...marketplace", topic: "listing-created" }

// Fungible token transfers
{ type: "ft_transfer", assetIdentifier: "SP3K8BC0...token-wstx" }

// All NFT activity
{ type: "nft_transfer" }

// New contract deployments
{ type: "contract_deploy" }
```

13 filter types total. See [references/filters.md](references/filters.md) for the complete list with all fields. Subgraphs use the same filter types (`SubgraphFilter`) for their named sources.

Wildcards supported in `contractId`, `functionName`, `contractName`: `"SP102*::amm-*"`, `"swap*"`.

### Manage streams

```bash
secondlayer streams list                             # list all (--status active/paused/failed)
secondlayer streams get <id>                         # details (supports partial IDs)
secondlayer streams set <id> active                  # enable
secondlayer streams set <id> disabled                # disable
secondlayer streams set <id> --retry                 # restart failed stream
secondlayer streams set <id> --retry --replay-failed # restart + replay failed deliveries
secondlayer streams set --all paused                 # pause all
secondlayer streams set --all paused --wait          # pause all + wait for queue drain
secondlayer streams delete <id>                      # delete (-f to skip confirm)
secondlayer streams logs <id> -f                     # tail delivery logs in real-time
secondlayer streams replay <id> --from 100 --to 200  # replay block range (max 10k)
secondlayer streams replay <id> --last 50            # replay last N blocks
secondlayer streams replay <id> --block 180500       # replay single block
secondlayer streams rotate-secret <id>               # generate new signing secret
```

SDK equivalents:
```typescript
await sl.streams.list({ status: "active" })
await sl.streams.get("abc123")        // supports partial IDs
await sl.streams.enable(id)
await sl.streams.disable(id)
await sl.streams.pauseAll()
await sl.streams.resumeAll()
await sl.streams.delete(id)
await sl.streams.listDeliveries(id, { limit: 20, status: "failed" })
await sl.streams.rotateSecret(id)
```

### Stream options

| Option | Default | Max | Description |
|--------|---------|-----|-------------|
| `decodeClarityValues` | `true` | — | Decode Clarity values in payloads |
| `includeRawTx` | `false` | — | Include raw transaction hex |
| `includeBlockMetadata` | `true` | — | Include block hash, timestamp, etc. |
| `rateLimit` | `10` | `100` | Max deliveries per second |
| `timeoutMs` | `10000` | `30000` | Endpoint response timeout (ms) |
| `maxRetries` | `3` | `10` | Retry attempts on failure |

### Delivery payload

Your endpoint receives a POST with this shape:

```typescript
{
  streamId: string;
  streamName: string;
  block: { height, hash, parentHash, burnBlockHeight, timestamp };
  matches: {
    transactions: [{ txId, type, sender, status, contractId, functionName }];
    events: [{ txId, eventIndex, type, data }];
  };
  isBackfill: boolean;   // true if from replay, false for live
  deliveredAt: string;   // ISO datetime
}
```

Verify payloads with the `X-Secondlayer-Signature` header (HMAC-SHA256 using your signing secret). Failed deliveries retry with exponential backoff up to `maxRetries`.

---

## Subgraphs

Subgraphs are TypeScript indexers that process blockchain events and write to SQL tables. Query via REST API or typed SDK client.

### Scaffold from contract

```bash
secondlayer subgraphs scaffold SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01 \
  -o subgraphs/alex-swaps.ts
```

Fetches the contract ABI and generates a complete `defineSubgraph()` scaffold with sources, schema, and handler stubs.

### Subgraph definition

```typescript
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "dex-swaps",
  version: "1.0.0",

  // What blockchain data to watch — named objects, keys become handler keys
  sources: {
    swap: { type: "print_event", contractId: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01", topic: "swap" },
  },

  // Optional: start indexing from a specific block (default: 1)
  startBlock: 150000,

  // SQL tables to create
  schema: {
    swaps: {
      columns: {
        sender:    { type: "principal", indexed: true },
        token_x:   { type: "text" },
        token_y:   { type: "text" },
        amount_x:  { type: "uint" },
        amount_y:  { type: "uint" },
      },
      indexes: [["sender", "token_x"]],  // composite index
      uniqueKeys: [["_txId"]],            // enables ctx.upsert()
    },
  },

  // How to process each matched event — handler key = source name
  handlers: {
    swap: (event, ctx) => {
      // event.data contains auto-unwrapped Clarity fields (camelized keys, bigint amounts)
      ctx.insert("swaps", {
        sender: ctx.tx.sender,
        token_x: event.data.tokenX,
        token_y: event.data.tokenY,
        amount_x: event.data.dx,   // bigint, not string
        amount_y: event.data.dy,
      });
    },
  },
});
```

### Column types

| Type | PG type | Use for |
|------|---------|---------|
| `text` | `text` | Strings, contract IDs |
| `uint` | `bigint` | Token amounts, counts |
| `int` | `bigint` | Signed integers |
| `principal` | `text` | Stacks addresses (SP..., ST...) |
| `boolean` | `boolean` | Flags |
| `timestamp` | `timestamptz` | Dates |
| `jsonb` | `jsonb` | Arbitrary nested data |

Column options: `nullable`, `indexed`, `search` (enables ILIKE on queries), `default`.

### Sources and handler key matching

Sources are **named objects**. The source name IS the handler key — no `sourceKey()` function, no `"contract::event"` string matching.

```typescript
// Source name = handler key. Use any descriptive name you want.
sources: {
  swap:       { type: "print_event", contractId: "SP...amm-pool-v2-01", topic: "swap" },
  addLiq:     { type: "contract_call", contractId: "SP...amm-pool-v2-01", functionName: "add-liquidity" },
  stxMoves:   { type: "stx_transfer", minAmount: 100000000n },
  tokenMint:  { type: "ft_mint", assetIdentifier: "SP...token-wstx" },
},
handlers: {
  swap:      (event, ctx) => { ... },
  addLiq:    (event, ctx) => { ... },
  stxMoves:  (event, ctx) => { ... },
  tokenMint: (event, ctx) => { ... },
  "*":       (event, ctx) => { ... },  // catch-all still supported
}
```

Source types use the `SubgraphFilter` type (same filter types as Streams — see filter reference above). No `SubgraphSource` type.

### Event payload shape

Event data is **auto-unwrapped** — no `{type, value}` Clarity wrappers. Amounts are `bigint`, not strings. Print event data keys are **camelized** (e.g., `token-x` becomes `tokenX`).

**`print_event` source:**
```typescript
{
  topic: "swap",              // the print event topic
  data: {                     // auto-unwrapped, camelized keys
    tokenX: "SP...token",
    tokenY: "SP...token",
    dx: 1000000n,             // bigint
    dy: 500000n,
  },
}
```

**`contract_call` source:**
```typescript
{
  args: {                     // decoded function arguments
    tokenX: "SP...token",
    amount: 500000n,
  },
  result: { ... },            // decoded return value
}
```

**`ft_transfer` / `ft_mint` / `ft_burn` source:**
```typescript
{
  sender: "SP...",            // ft_transfer / ft_burn
  recipient: "SP...",         // ft_transfer / ft_mint
  amount: 1000000n,           // bigint
  assetIdentifier: "SP...::token",
}
```

**`stx_transfer` source:**
```typescript
{
  sender: "SP...",
  recipient: "SP...",
  amount: 1000000n,           // bigint (microSTX)
}
```

Transaction metadata always available via `ctx.tx` — includes `txId`, `sender`, `type`, `status`, `contractId`, `functionName`.

### SubgraphContext (handler API)

```typescript
handlers: {
  swap: async (event, ctx) => {
    // Write operations — batched, flushed atomically per block
    ctx.insert("table", { col: value });
    ctx.update("table", { id: 1 }, { col: newValue });
    ctx.upsert("table", { txId: ctx.tx.txId }, { col: value }); // needs uniqueKeys
    ctx.delete("table", { id: 1 });
    ctx.patch("table", { id: 1 }, { col: newValue });           // partial update, preserves other fields

    // Computed upsert — values can be functions that receive existing row
    await ctx.patchOrInsert("balances", { address: "SP..." }, {
      address: "SP...",
      balance: (existing) => (existing ? existing.balance as bigint : 0n) + amount,
    });

    // Read operations — immediate against current DB state
    const row = await ctx.findOne("table", { sender: "SP..." });
    const rows = await ctx.findMany("table", { token: "wSTX" });

    // Aggregates
    const total = await ctx.count("table", { sender: "SP..." });
    const volume = await ctx.sum("table", "amount", { token: "wSTX" });
    const highest = await ctx.max("table", "amount");
    const lowest = await ctx.min("table", "amount");
    const traders = await ctx.countDistinct("table", "sender");

    // Utilities
    ctx.formatUnits(1000000n, 6);  // "1.0"

    // Context
    ctx.block.height;        ctx.block.hash;
    ctx.block.timestamp;     ctx.block.burnBlockHeight;
    ctx.tx.txId;             ctx.tx.sender;
    ctx.tx.type;             ctx.tx.status;
    ctx.tx.contractId;       ctx.tx.functionName;
  },
}
```

System columns added to every row automatically: `_id`, `_block_height`, `_tx_id`, `_created_at`.

### Handler patterns

See [references/subgraph-patterns.md](references/subgraph-patterns.md) for complete examples.

**DEX swap tracking:**
```typescript
sources: {
  swap: { type: "print_event", contractId: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01", topic: "swap" },
},
handlers: {
  swap: (event, ctx) => {
    ctx.insert("swaps", {
      sender: ctx.tx.sender,
      token_x: event.data.tokenX,
      token_y: event.data.tokenY,
      amount_x: event.data.dx,
      amount_y: event.data.dy,
    });
  },
}
```

**Running totals with patchOrInsert:**
```typescript
sources: {
  transfer: { type: "ft_transfer", assetIdentifier: "SP...::token" },
},
handlers: {
  transfer: async (event, ctx) => {
    ctx.insert("transfers", {
      from_addr: event.sender,
      to_addr: event.recipient,
      amount: event.amount,    // already bigint
    });

    // Update running balance — computed value receives existing row
    await ctx.patchOrInsert("balances", { address: event.recipient }, {
      address: event.recipient,
      balance: (existing) => (existing ? existing.balance as bigint : 0n) + event.amount,
    });
  },
}
```

**Conditional insert with findOne:**
```typescript
sources: {
  listing: { type: "print_event", contractId: "SP...marketplace", topic: "list-item" },
},
handlers: {
  listing: async (event, ctx) => {
    const existing = await ctx.findOne("listings", { nft_id: event.data.nftId });
    if (existing) {
      ctx.patch("listings", { nft_id: event.data.nftId }, {
        price: event.data.price,
        updated_block: ctx.block.height,
      });
    } else {
      ctx.insert("listings", {
        nft_id: event.data.nftId,
        seller: ctx.tx.sender,
        price: event.data.price,
      });
    }
  },
}
```

### Column type reference

See [references/column-types.md](references/column-types.md) for the complete mapping from Clarity types.

| Clarity type | Subgraph column | Notes |
|-------------|----------------|-------|
| `uint128` | `uint` | Token amounts, IDs |
| `int128` | `int` | Signed values |
| `principal` / `trait_reference` | `principal` | Stacks addresses |
| `bool` | `boolean` | Flags |
| `string-ascii` / `string-utf8` | `text` | Strings |
| `buff` | `text` | Hex-encoded buffers |
| `optional<T>` | mapped type + `nullable: true` | Unwraps inner type |
| `tuple` / `list` / `response` | `jsonb` | Complex nested data |

### Deploy & manage

```bash
secondlayer subgraphs deploy subgraphs/my-subgraph.ts              # deploy (creates or updates)
secondlayer subgraphs deploy subgraphs/my-subgraph.ts --reindex    # force reindex on breaking schema change
secondlayer subgraphs dev subgraphs/my-subgraph.ts                 # watch + hot-reload (local dev only)
secondlayer subgraphs list                                         # list deployed subgraphs
secondlayer subgraphs status my-subgraph                           # health, row counts, errors per table
secondlayer subgraphs reindex my-subgraph                          # reindex from block 1
secondlayer subgraphs reindex my-subgraph --from 150000            # reindex from specific block
secondlayer subgraphs delete my-subgraph                           # delete subgraph + all data (-y to skip confirm)
secondlayer subgraphs generate my-subgraph -o src/client.ts        # generate typed TypeScript client
```

### Query

**CLI**:
```bash
secondlayer subgraphs query my-subgraph swaps --limit 10 --sort amount_x --order desc
secondlayer subgraphs query my-subgraph swaps --filter sender=SP... --filter "amount_x.gte=1000"
secondlayer subgraphs query my-subgraph swaps --count
secondlayer subgraphs query my-subgraph swaps --fields sender,amount_x,amount_y
```

**REST API**:
```
GET /api/subgraphs/{name}/{table}?_sort=amount_x&_order=desc&_limit=10&sender=SP...
GET /api/subgraphs/{name}/{table}/count?sender=SP...
GET /api/subgraphs/{name}/{table}/{id}
```

Filter operators: `=`, `.gte`, `.lte`, `.gt`, `.lt`, `.neq`, `.like` (ILIKE).

**SDK (untyped)**:
```typescript
const rows = await sl.subgraphs.queryTable("my-subgraph", "swaps", {
  sort: "amount_x", order: "desc", limit: 10,
  filters: { sender: "SP...", "amount_x.gte": "1000" },
});
const { count } = await sl.subgraphs.queryTableCount("my-subgraph", "swaps");
```

**SDK (typed — recommended)**:
```typescript
import { getSubgraph } from "@secondlayer/sdk";
import mySubgraph from "./subgraphs/my-subgraph";

const subgraph = getSubgraph(mySubgraph, sl);
const swaps = await subgraph.swaps.findMany({
  where: { sender: "SP...", amount_x: { gte: 1000 } },
  orderBy: { amount_x: "desc" },
  limit: 10,
});
const total = await subgraph.swaps.count({ sender: "SP..." });
```

Or generate a standalone typed client:
```bash
secondlayer subgraphs generate my-subgraph -o src/subgraphs/my-subgraph-client.ts
```

---

## MCP Server

`@secondlayer/mcp` exposes all platform tools to AI agents via MCP (Model Context Protocol). 22 tools + 3 resources across streams, subgraphs, scaffold, templates, and account.

### Setup — IDE (stdio)

Add to your MCP client config (Claude Desktop, Cursor, VS Code):

```json
{
  "mcpServers": {
    "secondlayer": {
      "command": "npx",
      "args": ["@secondlayer/mcp"],
      "env": {
        "SECONDLAYER_API_KEY": "sl_live_..."
      }
    }
  }
}
```

### Setup — Remote (HTTP)

```bash
export SECONDLAYER_API_KEY=sl_live_...
export SECONDLAYER_MCP_SECRET=your-bearer-secret
npx @secondlayer/mcp-http
# Listening on port 3100
```

Endpoint: `POST/GET/DELETE /mcp`. Auth via `Authorization: Bearer <secret>`. Sessions tracked via `Mcp-Session-Id` header.

### Available tools

| Domain | Tools |
|--------|-------|
| Streams | `list`, `get`, `create`, `update`, `delete`, `toggle`, `deliveries`, `pause_all`, `resume_all`, `replay`, `rotate_secret` |
| Subgraphs | `list`, `get`, `query`, `reindex`, `delete`, `deploy` |
| Scaffold | `from_contract`, `from_abi` |
| Templates | `list`, `get` |
| Account | `whoami` |

`subgraphs_query` supports `fields` (column projection), `count` (row count), and filter operators (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`). Max limit: 200.

### MCP Resources

| URI | Description |
|-----|-------------|
| `secondlayer://filters` | Filter types reference |
| `secondlayer://column-types` | Column type mappings and options |
| `secondlayer://templates` | Available subgraph templates |

### MCP Error Handling

All tools return structured errors: `{ error: { type, status, message } }` with `isError: true`. Error types: `unauthorized` (401), `not_found` (404), `rate_limited` (429), `server_error` (5xx), `error` (other).

### Deploy via MCP

Agents can deploy subgraphs by passing TypeScript code directly:

```typescript
// Agent calls subgraphs_deploy with:
{
  code: "import { defineSubgraph } from '@secondlayer/subgraphs';\nexport default defineSubgraph({ ... })",
  reindex: false
}
// Returns: { action: "created", subgraphId: "...", message: "..." }
```

Code is bundled with esbuild, validated, and deployed — no file system access needed.

### Bulk operations

`streams_pause_all` and `streams_resume_all` use a confirm gate:

- `{ confirm: false }` (default) — returns preview of affected streams
- `{ confirm: true }` — executes the operation

---

## Error Handling (SDK)

```typescript
import { ApiError } from "@secondlayer/sdk";

try {
  await sl.streams.get("abc123");
} catch (err) {
  if (err instanceof ApiError) {
    // err.status — 401: invalid key, 404: not found, 429: rate limited
    // err.message — human-readable description
  }
}
```

Partial IDs supported: `sl.streams.get("abc1")` resolves via list. Throws 404 if no match, 400 if ambiguous.

---

## Templates

Curated subgraph templates available in the web dashboard at `/platform/subgraphs/templates`:

| Template | Category | Description |
|----------|----------|-------------|
| DEX Swap Tracking | DeFi | ALEX AMM pool swap events — token pairs, amounts, traders |
| NFT Marketplace | NFT | Listings, sales, cancellations with price tracking |
| Token Transfers | Token | FT transfers with running balance computation |
| BNS Names | Infrastructure | Name registrations and transfers on BNS |
| STX Whale Alerts | Token | Large STX transfers above configurable threshold |

Each template provides:
- Complete `defineSubgraph()` code ready to deploy
- Agent prompt for customization
- Downloadable .ts file

**Customization points:**
- Replace placeholder contract IDs (`SP...marketplace`) with real ones
- Adjust column types/indexes for your use case
- Add `uniqueKeys` to enable `ctx.upsert()` for idempotent writes
- Combine patterns (e.g., add balances table to swap tracker)
