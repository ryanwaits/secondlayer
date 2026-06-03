# Index API Quickstart

The **Index API** is a read-only, fully-decoded view of the Stacks chain — canonical blocks, full transaction documents, and decoded PoX-4 stacking actions — served over plain HTTP `GET`. Every endpoint is anonymous-readable in open beta (no key required), uses `snake_case` query params, and returns a standard cursor envelope. Finalized pages are aggressively cacheable (immutable + ETag), so syncing the chain is cheap.

This guide is runnable against production right now. Paste any block and you should see live data.

---

## Setup

**Base URL**

```
https://api.secondlayer.tools
```

**SDK install** (`@secondlayer/sdk@6.3.0` or later)

```bash
bun add @secondlayer/sdk
# or: npm i @secondlayer/sdk
```

**Auth** — reads are anonymous in open beta. An API key is optional and only raises your rate-limit tier.

```ts
import { SecondLayer } from "@secondlayer/sdk";

// No key — works for all reads:
const sl = new SecondLayer();

// Or with a key for a higher rate tier:
const sl = new SecondLayer({ apiKey: process.env.SL_API_KEY });
```

For curl, pass the key (if you have one) as a bearer token:

```bash
# anonymous (open beta):
curl -s "https://api.secondlayer.tools/v1/index/blocks?limit=2"

# with a key:
curl -s -H "Authorization: Bearer $SL_API_KEY" \
  "https://api.secondlayer.tools/v1/index/blocks?limit=2"
```

### Shared params (all Index endpoints)

| Param | Default | Notes |
|---|---|---|
| `limit` | `200` | max `1000` |
| `cursor` / `from_cursor` | — | resume from a `next_cursor` you got back |
| `from_height` / `to_height` | — | inclusive block-height range |
| (none) | — | with no cursor/`from_height`, you get the last ~1 day |

### The response envelope

Every list response looks like:

```jsonc
{
  "<resource>": [ /* rows, each with a "cursor" */ ],
  "next_cursor": "8153348:0",   // pass back as ?cursor= to page forward; null at the end
  "tip": {
    "block_height": 8170629,    // current chain tip we've indexed
    "finalized_height": 8170453,// everything <= this is past burn-finality (immutable)
    "lag_seconds": 120
  },
  "reorgs": []                  // present on transactions; canonical/blocks/stacking are lean
}
```

`tip.finalized_height` is the key number for caching: any page whose whole height range is `<= finalized_height` is served `immutable`.

---

## 1. Canonical chain (`/v1/index/canonical`)

A lean block-hash map over a height range — just enough to follow the one canonical chain: height, block hash, parent hash, and the burn block it anchors to. No `reorgs[]`, no extra columns. This is the cheapest way to sync, and the endpoint you build a follower on top of.

```bash
curl -s "https://api.secondlayer.tools/v1/index/canonical?from_height=147294&to_height=147300&limit=5"
```

```jsonc
{
  "canonical": [
    {
      "cursor": "147294:0",
      "block_height": 147294,
      "block_hash": "0x0bc44ee87ff35718df9c3786b453443be5f217631bac868a45740a2560fd00ce",
      "parent_hash": "0x9e7d3766b70282eb7752fb44a0f56d0f4c9f1a9ea80535f91883e833d40a2cd1",
      "burn_block_height": 840365,
      "burn_block_hash": null
    }
    // ... 4 more
  ],
  "next_cursor": "147298:0",
  "tip": { "block_height": 8170629, "finalized_height": 8170453, "lag_seconds": 114 }
}
```

```ts
// One page:
const page = await sl.index.canonical.list({ fromHeight: 147294, toHeight: 147300, limit: 5 });

// Auto-paginate the whole range (handles cursors for you):
for await (const row of sl.index.canonical.walk({ fromHeight: 147294, toHeight: 147400 })) {
  console.log(row.block_height, row.block_hash);
}
```

---

## 2. Blocks (`/v1/index/blocks` + `/blocks/{height_or_hash}`)

Canonical blocks with timestamps. Same shape as `/canonical` plus `block_time` and a `canonical` flag. Fetch a single block by height (always canonical) or by block hash (any block — check the `canonical` flag to know whether it's on the active chain). A missing block returns `404`.

```bash
curl -s "https://api.secondlayer.tools/v1/index/blocks?limit=2"
curl -s "https://api.secondlayer.tools/v1/index/blocks/147294"        # by height -> { block, tip }
curl -s "https://api.secondlayer.tools/v1/index/blocks/0x0bc44ee8..."  # by hash; inspect `canonical`
```

```ts
const { blocks, next_cursor } = await sl.index.blocks.list({ limit: 2 });
for await (const b of sl.index.blocks.walk({ fromHeight: 147294, toHeight: 147400 })) {
  console.log(b.block_height, b.block_time);
}

const res = await sl.index.blocks.get(147294); // -> { block, tip } | null
const byHash = await sl.index.blocks.get("0x0bc44ee8...");
if (byHash && !byHash.block.canonical) console.log("orphaned block");
```

---

## 3. Transactions (`/v1/index/transactions` + `/transactions/{tx_id}`)

Full transaction documents — the columnar fields plus `raw_tx`-decoded enrichment: `fee`, `nonce`, `sponsored`, `anchor_mode`, `post_condition_mode`, `post_conditions[]`, and a payload sub-object keyed by `tx_type` (`token_transfer` / `contract_call` / `smart_contract` / `coinbase` / `tenure_change`). Filter with `type`, `sender`, and `contract_id`. Cursor is `block_height:tx_index`; the envelope carries `reorgs: []`. Single get returns `{ transaction, tip }`, `404` if absent.

```bash
curl -s "https://api.secondlayer.tools/v1/index/transactions?type=contract_call&limit=1"
curl -s "https://api.secondlayer.tools/v1/index/transactions?type=token_transfer&limit=1"
curl -s "https://api.secondlayer.tools/v1/index/transactions/0xad7bf70f..."   # -> { transaction, tip }
curl -s "https://api.secondlayer.tools/v1/index/transactions?sender=SP17R9...&limit=10"
```

```jsonc
// a contract_call document (trimmed):
{
  "cursor": "8153349:0",
  "tx_id": "0xad7bf70f...248e3ef",
  "tx_type": "contract_call",
  "sender": "SP17R9JMVNT6H9PEF4Z7WVTNPZP9PDTV63DWV3XZE",
  "status": "success",
  "fee": "3000", "nonce": "26", "sponsored": false,
  "anchor_mode": "any", "post_condition_mode": "allow", "post_conditions": [],
  "contract_call": {
    "contract_id": "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2",
    "function_name": "swap-x-for-y",
    "function_args": ["...", "100", "84"],
    "result": "86",
    "result_hex": "0x070100000000000000000000000000000056"
  }
}
```

```ts
const { transactions } = await sl.index.transactions.list({
  type: "contract_call",
  contractId: "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2",
  limit: 10,
});

for await (const tx of sl.index.transactions.walk({ sender: "SP17R9..." })) {
  console.log(tx.tx_type, tx.tx_id);
}

const one = await sl.index.transactions.get("0xad7bf70f..."); // -> { transaction, tip } | null
if (one && one.transaction.tx_type === "contract_call") {
  console.log(one.transaction.contract_call.function_name);
}
```

---

## 4. Stacking (`/v1/index/stacking`)

Decoded PoX-4 stacking actions — every call to the PoX contract, decoded into typed fields. Filter by `function_name` (e.g. `stack-stx`, `delegate-stx`, `delegate-stack-stx`, `revoke-delegate-stx`), `stacker`, or `caller`. Each row carries `caller`, `stacker`, `delegate_to`, `amount_ustx`, `lock_period`, `pox_addr {version, hashbytes, btc}`, `start_cycle` / `end_cycle` / `reward_cycle`, `signer_key`, and `result_ok`. Fields that don't apply to a given function (or that come from a failed call) are `null`. Full history is backfilled — 134k+ actions back to block 147,294.

```bash
curl -s "https://api.secondlayer.tools/v1/index/stacking?function_name=delegate-stack-stx&from_height=7184000&to_height=7185000&limit=1"
curl -s "https://api.secondlayer.tools/v1/index/stacking?stacker=SP4VG5YE...&limit=10"
```

```jsonc
{
  "stacking": [{
    "cursor": "7184286:6",
    "block_height": 7184286,
    "function_name": "delegate-stack-stx",
    "caller": "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG",
    "stacker": "SP4VG5YE38JEZD120SMCCERXVKNJWWW5J8G50GBE",
    "amount_ustx": "1118000000",
    "lock_period": 1,
    "pox_addr": { "version": 4, "hashbytes": "0xcf510f80...", "btc": "bc1qeagslq8gm4ylmgxf9ngx24mnwffsqnprrsjc0n" },
    "start_cycle": 130, "end_cycle": 130, "reward_cycle": null,
    "result_ok": true
  }],
  "next_cursor": "7184286:6",
  "tip": { "block_height": 8170630, "finalized_height": 8170453, "lag_seconds": 133 }
}
```

```ts
for await (const action of sl.index.stacking.walk({ stacker: "SP4VG5YE..." })) {
  console.log(action.function_name, action.amount_ustx, action.pox_addr.btc);
}
```

---

## Verify caching (ETag / 304)

Every Index read sets `Cache-Control`:

- Finalized range (whole window `<= tip.finalized_height`) → `public, max-age=31536000, immutable` + a weak `ETag` (computed over the data slice, not the moving tip).
- Not yet finalized → `private, max-age=2`.

A matching `If-None-Match` on a finalized page returns `304 Not Modified` with no body. Single-resource gets are immutable once their block finalizes.

```bash
# 1. Fetch a finalized range and read the headers:
curl -si "https://api.secondlayer.tools/v1/index/canonical?from_height=147294&to_height=147300&limit=5" \
  | grep -i -E '^(HTTP|cache-control|etag)'
# -> HTTP/2 200 | cache-control: public, max-age=31536000, immutable | etag: W/"..."

# 2. Replay with If-None-Match and get a 304:
ETAG=$(curl -si "https://api.secondlayer.tools/v1/index/canonical?from_height=147294&to_height=147300&limit=5" \
  | grep -i '^etag:' | tr -d '\r' | awk '{print $2}')
curl -si -H "If-None-Match: $ETAG" \
  "https://api.secondlayer.tools/v1/index/canonical?from_height=147294&to_height=147300&limit=5" \
  | grep -i -E '^(HTTP|cache-control|etag)'
# -> HTTP/2 304
```

A `304` (no body) means your cached copy is still valid. Any standard HTTP cache (browser, CDN, `fetch`) honors these automatically, so re-reading finalized history is effectively free.

---

## Recipe: Sync the canonical chain

Follow only the one canonical chain with two cheap calls: `/canonical` gives you the hash map, then `/blocks` (or `/transactions`) fills in detail per height. Persist `next_cursor` to resume; persist `tip.finalized_height` to know what's safe to cache forever.

```ts
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer();
let lastHeight = 147294; // load from your own checkpoint store
const head = 147400;

for await (const blk of sl.index.canonical.walk({ fromHeight: lastHeight, toHeight: head })) {
  // blk.parent_hash chains back; verify continuity if you want reorg safety.
  for await (const tx of sl.index.transactions.walk({ fromHeight: blk.block_height, toHeight: blk.block_height })) {
    handle(tx);
  }
  lastHeight = blk.block_height; // checkpoint as you go
}
```

Why `/canonical` over `/blocks` for syncing: it's the leanest payload, and finalized ranges are `immutable` — so a follower caught up to `finalized_height` re-reads cost nothing. Watch `tip.block_height` for new work and `tip.finalized_height` for what's now permanent.

---

## Related (already-shipped Index clients)

For event-level and token-flow data, the existing Index clients pair with the four above — same envelope, cursor, and caching:

- `sl.index.events` — decoded contract events (`print`, `stx_transfer`, `ft_*`, `nft_*`, …)
- `sl.index.ftTransfers` — SIP-010 fungible-token transfers
- `sl.index.nftTransfers` — SIP-009 NFT transfers
- `sl.index.contractCalls` — decoded contract calls
