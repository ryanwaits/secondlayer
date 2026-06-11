# @secondlayer/sdk

TypeScript SDK for the Second Layer API.

## Install

```bash
bun add @secondlayer/sdk
```

## Quick Start

```typescript
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({
  apiKey: "sk-sl_...",                          // or `sl login` session token
  baseUrl: "https://api.secondlayer.tools",     // default
});
```

`sl.contracts`, `sl.index`, and `sl.subgraphs` reads are anonymous
— no key needed (`sl.index` rejects free-tier keys — Build+ for keyed access).
**`sl.streams` reads require a bearer token** (`apiKey`) and resolve a per-tier tenant; a
publicly-known free-tier token exists but a bearer is always required. Writes
require an `sk-sl_` API key, created in the platform console at
https://secondlayer.tools/platform/api-keys. (Public Streams bulk dumps —
`client.dumps`, `events.replay` — need no key.)

**API keys.** Each `sk-sl_` key has a `product`. An **`account`** key (dashboard
default) grants both `streams:read` and `index:read` and is the only key that can
mint new keys; **`streams`** / **`index`** keys are scoped, read-only, and cannot
mint. Mint scoped keys programmatically with `sl.apiKeys.create({ product })`
(needs an account/owner key) — the returned `key` is shown once and inherits your
plan's tier.

## Mental model

- `sl.streams` reads raw ordered L1 events from Stacks Streams.
- `sl.index` reads the decoded L2 layer from Stacks Index — FT/NFT transfers, all event types (`events`), and `contractCalls`.
- `sl.contracts` finds deployed contracts by trait (SIP-009/010/013).
- `sl.subgraphs` reads app-specific L3 tables from Stacks Subgraphs.

## Stacks Streams

Typed L1 HTTP client. Reads require a bearer token (`apiKey`).

```typescript
const tip = await sl.streams.tip();
// tip.finalized_height — highest immutable (past Bitcoin-anchored finality) block
const page = await sl.streams.events.list({
  types: ["ft_transfer"],
  contractId: "SP...sbtc-token",
  sender: "SP...",       // exact payload sender (events that have one)
  recipient: "SP...",    // exact payload recipient
  assetIdentifier: "SP...token::asset", // exact FT/NFT asset id
  limit: 10,
});
// each event carries `finalized: boolean`
console.log({ tip, firstCursor: page.events[0]?.cursor });
```

`createStreamsClient` remains available for focused Streams-only consumers:

```typescript
import { createStreamsClient } from "@secondlayer/sdk";

const streams = createStreamsClient({
  apiKey: process.env.SL_API_KEY!, // sk-sl_... — required for reads
  // verify: true,                 // verify ed25519 X-Signature on every read
  //                               // (auto-fetches the public key; { publicKey } pins a PEM)
  // dumpsBaseUrl: process.env.SL_STREAMS_DUMPS_URL, // required to use client.dumps
});
```

Verified responses: every Streams read is signed (ed25519 `X-Signature` +
`X-Signature-KeyId`). Pass `verify: true` to check it on every read (or
`{ publicKey }` to pin a PEM); a missing/bad signature throws
`StreamsSignatureError`. The public key is at
`GET /public/streams/signing-key`.

Convenience reads:

```typescript
await sl.streams.canonical(182431);
await sl.streams.events.byTxId("0x...");
await sl.streams.blocks.events(182431);
await sl.streams.blocks.events("0xindex-block-hash");
await sl.streams.reorgs.list({ since: "2026-05-03T00:00:00.000Z" });
```

Checkpointed consumer.

Use `client.events.consume` for indexers and ETL jobs. Write your database rows
inside `onBatch`, then return the cursor you committed. It exits when
`maxPages`, `maxEmptyPolls`, or `signal` stops it.

```typescript
await streams.events.consume({
  types: ["ft_transfer"],
  batchSize: 100,
  maxPages: 1,
  onBatch: async (events, envelope) => {
    for (const event of events) {
      console.log(event.cursor, event.tx_id);
    }
    return envelope.next_cursor;
  },
});
```

Live stream.

Use `client.events.stream` for live processors and watch-style apps. It follows
the tip indefinitely. Stop it with an `AbortSignal`.

```typescript
const abort = new AbortController();
process.once("SIGINT", () => abort.abort());

for await (const event of streams.events.stream({
  types: ["ft_transfer"],
  batchSize: 100,
  signal: abort.signal,
})) {
  console.log(event.cursor, event.tx_id);
}
```

Real-time push (`events.subscribe`).

Use `client.events.subscribe` for callback-style live delivery — it pushes each
event to `onEvent` as it lands. It's fetch-based (so it carries the Bearer key)
and works in browsers and Node 18+. It auto-reconnects from the last delivered
cursor on a dropped connection, and returns an unsubscribe function.

```typescript
const unsubscribe = streams.events.subscribe({
  types: ["ft_transfer"],          // notTypes / contractId / sender / recipient / assetIdentifier also filter
  // fromCursor: lastCursor,       // resume strictly after this cursor; omit to tail from the tip
  onEvent: async (event) => {
    console.log(event.cursor, event.tx_id);
  },
  onError: (err) => console.error("reconnecting…", err),
});

// later
unsubscribe(); // or pass `signal` and abort it
```

Each pushed frame is `{ event, sig, key_id }`. When the client was created with
`verify` (or `{ publicKey }`), the per-frame ed25519 signature is checked before
`onEvent` runs; a bad/missing signature throws `StreamsSignatureError`.

Bulk parquet dumps.

Finalized history is published as public parquet files. Set `dumpsBaseUrl`
(or `SL_STREAMS_DUMPS_URL`) — no API key needed for dumps. The SDK does **not**
decode parquet; `download` hands you sha256-verified bytes to process with your
own tooling.

The bulk **manifest is ed25519-signed**, and the SDK verifies that signature
before it trusts any per-file sha256 listed in it. The `verifyDumpsManifest`
option **defaults to `true`** — `dumps.list()` and `events.replay()` enforce it,
so you don't trust the file hashes unless the manifest itself verifies. Opt out
with `verifyDumpsManifest: false`.

```typescript
const streams = createStreamsClient({
  apiKey: process.env.SL_API_KEY!,
  dumpsBaseUrl: process.env.SL_STREAMS_DUMPS_URL!,
});

const manifest = await streams.dumps.list();       // parse the manifest
for (const file of manifest.files) {
  const bytes = await streams.dumps.download(file); // fetch + verify sha256
  await myParquetReader(bytes);
}
```

Backfill then tail (`events.replay`).

Backfills from bulk dumps, then tails live from the manifest's
`latest_finalized_cursor` — no gap or dupe at the seam. `onDumpFile` hands you
each finalized file; `onBatch` receives live events after the seam.

```typescript
await streams.events.replay({
  from: lastCheckpoint,
  async onDumpFile(file) {
    const bytes = await streams.dumps.download(file);
    await ingestParquet(bytes); // your tooling
  },
  async onBatch(events, envelope) {
    for (const event of events) await handle(event);
    return envelope.next_cursor;
  },
});
```

Decoder helper.

```typescript
import { decodeFtTransfer, isFtTransfer } from "@secondlayer/sdk";

for await (const event of streams.events.stream({ types: ["ft_transfer"] })) {
  if (!isFtTransfer(event)) continue;
  const transfer = decodeFtTransfer(event);
  console.log(transfer.decoded_payload);
  break;
}
```

Helper convention: each event helper is a pure function with no shared state.
Use `is<EventName>(event)` as the type guard and `decode<EventName>(event)` as
the decoder. Decoders throw when the event type or payload is malformed. Add new
helpers beside `src/streams/ft-transfer.ts` and export them through
`src/streams/index.ts`.

## Stacks Index

Decoded L2 transfer events.

```typescript
const ftPage = await sl.index.ftTransfers.list({
  contractId: "SP...sbtc-token",
  sender: "SP...",
  limit: 100,
});

const nftPage = await sl.index.nftTransfers.list({
  assetIdentifier: "SP...collection::token",
  recipient: "SP...",
});
```

Backfill with SDK walkers:

```typescript
for await (const transfer of sl.index.ftTransfers.walk({
  fromHeight: 0,
  batchSize: 500,
})) {
  console.log(transfer.cursor, transfer.amount);
}
```

## Transaction-inclusion proofs

Verify — **without trusting Second Layer** — that a transaction is included in a
Stacks (Nakamoto) block, and that ≥70% of the reward cycle's signer weight
attested to that block. `verifyTransactionProof` recomputes everything
client-side and trusts nothing the API returned.

> Verification uses Node's crypto via `@secondlayer/shared` — Node/server-side use.

```typescript
import { verifyTransactionProof, fetchRewardSet } from "@secondlayer/sdk";

const proof = await fetch(
  `https://api.secondlayer.tools/v1/index/transactions/${txid}/proof`,
).then((r) => r.json());

const result = verifyTransactionProof(proof); // anchored + consensus (embedded set)
// result.ok, result.level === "consensus", result.signerWeightBps

// Fully trustless — resolve the reward set from your own node:
const rewardSet = await fetchRewardSet({
  nodeUrl: "https://your-stacks-node:20443",
  cycle: proof.consensus.reward_cycle,
});
const trustless = verifyTransactionProof(proof, { rewardSet }); // rewardSetSource: "provided"
```

Two trust levels:

- **Anchored** — recompute the txid from `raw_tx`, fold `tx_merkle_path` up to the
  header's `tx_merkle_root`, and recompute `block_hash` + `index_block_hash` from
  `raw_header`. The tx is in a header any node can corroborate.
- **Consensus** — additionally recover the header's signer signatures and confirm
  ≥70% of the reward cycle's signer weight signed the block. Fully trustless when
  you pass a `rewardSet` resolved yourself via `fetchRewardSet`
  (`rewardSetSource: "provided"`); otherwise it uses the proof's embedded set
  (`rewardSetSource: "embedded"`).

```typescript
verifyTransactionProof(
  proof: TransactionProof,
  opts?: { rewardSet?: RewardSet },
): TransactionProofVerifyResult;

fetchRewardSet(opts: {
  nodeUrl: string;            // your own stacks-node
  cycle: number;             // reward cycle — proof.consensus.reward_cycle
  fetchImpl?: typeof fetch;
}): Promise<RewardSet | null>; // reads /v3/stacker_set/{cycle}
```

`verifyTransactionProof` returns a `TransactionProofVerifyResult`:

```typescript
{
  level: "anchored" | "consensus";
  txidMatches: boolean;
  includedInHeader: boolean;
  headerSelfConsistent: boolean;
  signerWeightBps?: number;   // consensus only
  thresholdMet?: boolean;     // consensus only — ≥70% (7000 bps)
  rewardSetSource?: "provided" | "embedded";
  ok: boolean;
  errors: string[];
}
```

Exported types: `TransactionProof`, `TransactionProofVerifyResult`, `RewardSet`.

## Stacks Subgraphs

Deploy and query app-specific L3 tables.

Subgraphs and subscriptions live on the platform API alongside Streams and Index. Deploying and managing them needs your `sk-sl_` key — no extra setup, no tenant URL.

```typescript
// List
const { data } = await sl.subgraphs.list();

// Get
const subgraph = await sl.subgraphs.get("my-subgraph");

// Open read (/v1) — keyless for public subgraphs; pass apiKey for your private ones
const { rows, next_cursor, tip } = await sl.subgraphs.rows("my-subgraph", "transfers", {
  order: "desc",
  limit: 50,
  // cursor: next_cursor — pass back to resume
});

// Authed control-plane query (/api)
const page = await sl.subgraphs.queryTable("my-subgraph", "transfers", {
  sort: "block_height",
  order: "desc",
  limit: 50,
});

const { count } = await sl.subgraphs.queryTableCount(
  "my-subgraph",
  "transfers",
);

const spec = await sl.subgraphs.openapi("my-subgraph");
const source = await sl.subgraphs.getSource("my-subgraph");
const gaps = await sl.subgraphs.gaps("my-subgraph");

// Deploy — managed deploys default visibility "public", BYO default "private"
const result = await sl.subgraphs.deploy({ name, sources, schema, handlerCode, visibility: "public" });

// Flip visibility — publish claims the global public name (409 PUBLIC_NAME_TAKEN if claimed)
await sl.subgraphs.publish("my-subgraph");
await sl.subgraphs.unpublish("my-subgraph");
```

Stream rows live with the typed client — each table exposes `subscribe`
alongside `findMany`/`count`:

```typescript
const subgraph = sl.subgraphs.typed(myDefinition); // { transfers, ... }

const unsubscribe = subgraph.transfers.subscribe(
  (row) => console.log(row),
  {
    where: { amount: { gte: "1000000" } }, // optional row filter
    since: 180000,                          // optional: replay from this block_height, then tail
    onError: (err) => console.error(err),
  },
);

// later
unsubscribe();
```

`subscribe` is an SSE stream over the global `EventSource` (available in
browsers and Node ≥ 22; it throws if no `EventSource` is present). Frames are
unsigned rows. `since: <block_height>` replays matching rows from that height,
then tails the live edge; omit it to tail only.

## Subscriptions

Signed HTTP webhooks. Subscriptions are polymorphic — pick one kind:

- **subgraph** — fires on rows written to a deployed subgraph table.
- **chain** — fires on raw chain events with no subgraph. Forward-looking: it
  starts at the chain tip and never backfills. The turnkey "webhook on a
  contract / event / function / trait".

```typescript
// List / get
const { data } = await sl.subscriptions.list();
const sub = await sl.subscriptions.get(id);

// Create a SUBGRAPH subscription — sink a subgraph table to a signed endpoint.
// `signingSecret` is returned ONCE; store it in the receiver's env.
const { subscription, signingSecret } = await sl.subscriptions.create({
  name: "whale-alerts",
  subgraphName: "transfers",
  tableName: "events",
  url: "https://example.com/hooks/transfers",
  format: "standard-webhooks", // or inngest | trigger | cloudflare | cloudevents | raw
});
```

### Chain subscriptions

Pass `triggers` instead of `subgraphName`/`tableName`. The `trigger.*` builders
are optional sugar — you can also pass raw objects (e.g.
`{ type: "contract_call", contractId: "SP....amm", functionName: "swap-*" }`).
All string fields accept `*` wildcards; `trait` scopes to contracts conforming
to a SIP/trait (e.g. `"sip-010"`); amounts are non-negative integer strings
(uint128-safe) or numbers.

```typescript
import { SecondLayer, trigger } from "@secondlayer/sdk";

const sl = new SecondLayer({ apiKey: "sk-sl_..." });

const { subscription, signingSecret } = await sl.subscriptions.create({
  name: "amm-swaps",
  url: "https://my-app.com/webhook",
  triggers: [
    trigger.contractCall({ contractId: "SP....amm", functionName: "swap-*" }),
    trigger.ftTransfer({ trait: "sip-010", minAmount: "1000000" }),
  ],
});
```

One builder per event type:
`trigger.stxTransfer` / `stxMint` / `stxBurn` / `stxLock`,
`trigger.ftTransfer` / `ftMint` / `ftBurn`,
`trigger.nftTransfer` / `nftMint` / `nftBurn`,
`trigger.contractCall`, `trigger.contractDeploy`, `trigger.printEvent`.

Delivery envelope (chain subs only): each apply is `chain.{type}.apply` with
body `{ action: "apply", block_hash, block_height, tx_id, canonical, trigger,
event }`. On reorg you get `chain.reorg.rollback` with `{ action: "rollback",
fork_point_height, orphaned: [{ tx_id, event }] }`. Delivery is at-least-once: a
tx surviving a reorg re-delivers an apply under its new `block_hash`, so key
consumer state on `(tx_id, block_hash)`. Per-subscription HMAC signing (Standard
Webhooks) is unchanged for both kinds.

```typescript
// Lifecycle (both kinds)
await sl.subscriptions.update(id, { filter: { amount: { gte: "1000000" } } });
await sl.subscriptions.pause(id);
await sl.subscriptions.resume(id);
await sl.subscriptions.rotateSecret(id); // returns new signing secret once
const { data: deliveries } = await sl.subscriptions.recentDeliveries(id);

// Replay historical block range
await sl.subscriptions.replay(id, { fromBlock: 180000, toBlock: 181000 });

// Dead-letter inspection + requeue
const { data: dead } = await sl.subscriptions.dead(id);
await sl.subscriptions.requeueDead(id, outboxId);
```

### Verifying deliveries

Every delivery — any kind, any `format` — also carries a universal authenticity
signature you can verify with one published key, no per-subscription secret. The
headers are `webhook-id`, `x-secondlayer-signature`, and
`x-secondlayer-signature-keyid`; the signed content is `` `${webhook-id}.${rawBody}` ``
(ed25519). Fetch the public key from `GET /public/streams/signing-key`.

```typescript
import { verifySecondlayerSignature } from "@secondlayer/sdk";

app.post("/webhook", async (c) => {
  const raw = await c.req.text(); // raw body — never re-stringify the parsed JSON
  if (!verifySecondlayerSignature(raw, c.req.raw.headers, SECONDLAYER_PUBLIC_KEY)) {
    return c.text("Invalid signature", 401);
  }
  // ... trusted ...
  return c.body(null, 204);
});
```

```typescript
verifySecondlayerSignature(
  rawBody: string,
  headers: WebhookHeaderInput,   // plain object, Fetch `Headers`, or a lookup fn
  publicKeyPem: string,
): boolean;
```

Prefer the per-subscription HMAC (Standard Webhooks) secret instead? Use
`verifyWebhookSignature(rawBody, headers, secret)` — raw body first.

## x402 pay-per-call (accountless)

Call the public `/v1/*` reads with **no API key, no account, no Stripe** — pay a
few hundredths of a cent per request from a Stacks wallet. Payment is **gasless**
(you sign; we sponsor the STX fee) and uses standard **x402 v2** on `stacks:1`.
Supported assets: **sBTC** (default), **USDCx**, **STX**.

> Keyed (`sk-sl_`) requests bypass x402 and bill through your plan — x402 is for
> accountless callers.

Drop-in `fetch` that pays on `402` automatically:

```typescript
import { withX402, readX402Receipt } from "@secondlayer/sdk";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";

const x402fetch = withX402(fetch, {
  account: privateKeyToAccount(process.env.AGENT_STACKS_KEY!), // funded with sBTC/USDCx
  preferAssets: ["sBTC", "USDCx", "STX"],   // optional (this is the default)
  maxAmountPerCall: { sBTC: 2000n },        // optional spend guard (atomic units)
});

const res = await x402fetch(
  "https://api.secondlayer.tools/v1/index/events?event_type=ft_transfer",
);
const data = await res.json();
readX402Receipt(res); // { success, txid, payer, network } | null
```

Or a small client returning `{ data, payment }`:

```typescript
import { createX402Client } from "@secondlayer/sdk";

const sl = createX402Client({ account, baseUrl: "https://api.secondlayer.tools" });
const { data, payment } = await sl.get("/v1/index/events", {
  query: { event_type: "ft_transfer" },
});
```

The SDK selects an offer by `preferAssets` (skipping any over `maxAmountPerCall`,
else throws `X402SpendGuardError`), auto-resolves your account nonce, signs
origin-only, and retries. A paid call settles on-chain before returning
(confirmed-tier today, ~seconds; near-instant optimistic serve for Index/Streams
is rolling out). Discover capabilities at `GET /x402/supported`.

## Error Handling

```typescript
import { ApiError } from "@secondlayer/sdk";

try {
  await sl.subgraphs.get("nonexistent");
} catch (err) {
  if (err instanceof ApiError) {
    console.log(err.status);  // 404
    console.log(err.code);    // "NOT_FOUND" (from API's {error, code} envelope, if present)
    console.log(err.message); // "Subgraph not found"
    console.log(err.body);    // full parsed envelope
  }
}
```

Tenant-resolution failures surface as `ApiError` with distinctive codes:

- `code: "TENANT_SUSPENDED"` — your tenant is suspended (see `err.message` for the limit reason)
- `code: "NO_TENANT"` — your account has no provisioned tenant yet
