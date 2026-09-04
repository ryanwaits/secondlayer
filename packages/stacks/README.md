# @secondlayer/stacks

A viem-style SDK for the Stacks blockchain. One package, zero polyfills, full tree-shaking.

## Install

```bash
bun add @secondlayer/stacks
```

## Quick Start

```ts
import { createPublicClient, http } from "@secondlayer/stacks";
import { mainnet } from "@secondlayer/stacks/chains";

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
});

const balance = await client.getBalance({
  address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
});
```

## Clarinet simnet

Same client as HTTP, against an in-process VM (`@stacks/clarinet-sdk` is an optional peer of this entry).

```ts
import { initSimnet } from "@stacks/clarinet-sdk";
import { createPublicClient } from "@secondlayer/stacks";
import { simnet, simnetChain } from "@secondlayer/stacks/simnet";

const session = await initSimnet("./Clarinet.toml");
const client = createPublicClient({
  chain: simnetChain,
  transport: simnet(session),
});
```

Then `getContract` as on mainnet. No `/extended`; watches throw; fees use `'min'`.

## Exports

| Module | Description |
|---|---|
| `@secondlayer/stacks` | Clients, transports, re-exports |
| `@secondlayer/stacks/accounts` | `privateKeyToAccount`, `mnemonicToAccount`, wallet providers |
| `@secondlayer/stacks/chains` | `mainnet`, `testnet`, `devnet`, `defineChain` |
| `@secondlayer/stacks/clarity` | `Cl.*` constructors, serialization, ABI type system |
| `@secondlayer/stacks/actions` | `readContract`, `callContract`, `transferStx`, `getContract`, `multicall` |
| `@secondlayer/stacks/transactions` | Build, sign, serialize transactions, multi-sig |
| `@secondlayer/stacks/postconditions` | `Pc` fluent builder for post-conditions |
| `@secondlayer/stacks/utils` | Encoding, hashing, addresses, unit formatting |
| `@secondlayer/stacks/bitcoin` | Trust-minimized Bitcoin SPV — proof construction, Clarity codecs, verifier (SIP-044) |
| `@secondlayer/stacks/pox5` | PoX-5 Bitcoin Staking (SIP-045) — bonds, staking, lockup scripts, signer grants |
| `@secondlayer/stacks/sbtc` | `sbtc()` client extension: sBTC deposits, balances, withdrawals |
| `@secondlayer/stacks/filters` | Event and transaction filter builders, re-exported from the root |
| `@secondlayer/stacks/simnet` | Clarinet simnet transport — same `getContract` client against an in-process VM |

### Frozen modules

These ship and work but get no further investment — they may be removed in a
future major. Prefer Hiro's maintained `@stacks/*` ecosystem for wallet-side
work; Secondlayer is a data-infrastructure company, not a wallet SDK vendor.

Nonce coordination (below) is the exception — it is supported and maintained:
it's mempool-aware (built on Secondlayer's data plane) and solves a real
multi-broadcast gap, which is why it lives here rather than being deferred to
`@stacks/*`.

| Module | Description |
|---|---|
| `@secondlayer/stacks/connect` | Wallet connection — browser extensions + `setProvider` |
| `@secondlayer/stacks/connect/walletconnect` | WalletConnect v2 — native relay, QR, modal |
| `@secondlayer/stacks/subscriptions` | `watchBlocks`, `watchMempool`, `watchTransaction` |
| `@secondlayer/stacks/bns` | BNS name registration, resolution, zonefiles |
| `@secondlayer/stacks/pox` | PoX stacking — solo and delegated |
| `@secondlayer/stacks/stackingdao` | StackingDAO liquid staking (STX/stSTX) |

### Deprecated: `/tools` and `/tools/btc`

Give your agent Stacks reads through [`@secondlayer/mcp`](https://www.npmjs.com/package/@secondlayer/mcp) instead. The two AI SDK tool entries below still import, and stay until the next major, but they get no new tools. The tradeoff of keeping them: `ai` and `zod` are now optional peer dependencies, so a project that imports either entry installs both itself; a project that only reads contracts installs neither.

| Module | Description |
|---|---|
| `@secondlayer/stacks/tools` | **Deprecated.** AI SDK `tool()` set for Stacks reads. Bare exports read `STACKS_NETWORK` (or `STACKS_CHAIN`) and `STACKS_NODE_RPC_URL`, `SL_API_URL` or `STACKS_RPC_URL`; `createStacksTools(client)` binds your own client |
| `@secondlayer/stacks/tools/btc` | **Deprecated.** AI SDK `tool()` set for Bitcoin reads via mempool.space (`BTC_MEMPOOL_URL` overrides the host) |

## Fee tiers

Every send action takes `fee` as an exact amount **or a named tier**: `'min' | 'low' | 'mid' | 'high'`. Tiers map to the node's three estimations; `'min'` is the minimum relay fee (1 uSTX per serialized byte), computed offline with no round-trip. Omitting `fee` estimates mid. When the node answers `NoEstimateAvailable` (a quiet chain or fresh devnet with no fee history), the SDK falls back to `'min'` instead of failing; `resolveFee` returns `{ fee, tier }` so you can see which happened. Any other estimator failure (timeout, 5xx, auth) throws rather than silently under-paying, and the nonce reserved for that send is handed back.

```ts
await client.transferStx({ to, amount: 1000n, fee: "low" });
await client.callContract({ contract, functionName: "mint", fee: "min" });
```

## Wait for confirmation

`waitForTransactionReceipt` polls until a transaction is mined (optionally N confirmations deep) and returns a normalized receipt with the decoded Clarity result. It rejects with typed errors when the tx aborts (`TransactionAbortedError`, receipt attached), drops from the mempool (`TransactionDroppedError`), or times out — and it re-reads block placement every cycle, so reorgs don't strand the wait.

```ts
const txid = await client.callContract({ contract, functionName: "mint" });
const receipt = await client.waitForTransactionReceipt({ txid, confirmations: 2 });
receipt.result; // decoded ClarityValue

// or in one step:
const { receipt } = await sendTransaction(client, { transaction, wait: 2 });
```

Status reads are pluggable, like nonce sources: the default reads `/extended/v1/tx` on your transport host; `indexTxSource()` reads `/v1/index/transactions` on your Secondlayer instance, which returns the chain tip in the same response, so N-confirmation waits cost one request per poll. The index only knows mined transactions, so with this source the dropped-grace window defaults to the full `timeout` instead of 30s. Without `baseUrl` the transport URL is assumed to be your instance: a Hiro transport throws up front, and a host that answers `/v1/index` with a non-JSON 404 (a bare stacks-node) throws on the first poll instead of waiting out the timeout. A `baseUrl` other than the transport host reuses the transport's retry and timeout policy only; the transport's `apiKey` and `fetchOptions` stay with the transport host. Rejection reasons are typed too: `BroadcastError.reason` is a literal union of all 26 stacks-node rejection strings (with `reasonData` and `txid` attached).

## Errors

The HTTP transport throws a typed `HttpRequestError` (`.status`, `.url`, `.method` attached) on any non-2xx response instead of handing back the error body as if it were a successful result, and it retries `429`s, not just `5xx`/network errors. One `timeout` covers each attempt end to end, headers and body, so a stalled response rejects with `TimeoutError` (`.url`, `.method`, `.timeout`, `.attempt`) instead of hanging. Pass `signal` on any request to cancel from your side; a caller abort is never retried. Broadcasts are sent once (`retryCount: 0`): re-posting a transaction the node may already hold would surface as a nonce conflict, so a timed-out broadcast checks whether the node knows the tx before failing. `MalformedResponseError` throws from `getBalance`, `getAccountInfo`, `getMapEntry`, `getBlockHeight`, and `getBurnBlockHeight` when the node's response is missing an expected field, instead of failing with an opaque native error (`BigInt(undefined)` and friends). Both are exported from `@secondlayer/stacks`. Every error carries a stable `code` (`HTTP_REQUEST_ERROR`, `TIMEOUT_ERROR`, `MALFORMED_RESPONSE_ERROR`, ...) that also appears in `toJSON()`, so a handler can branch on it without an `instanceof` chain and without parsing a message that may be reworded.

```ts
import { BaseError, HttpRequestError, MalformedResponseError, TimeoutError } from "@secondlayer/stacks";

try {
  await client.getBalance({ address });
} catch (e) {
  if (e instanceof HttpRequestError) e.status; // non-2xx from the node/API
  if (e instanceof TimeoutError) e.url; // headers or body did not arrive in time
  if (e instanceof MalformedResponseError) { /* response shape didn't match */ }
  if (e instanceof BaseError) e.code; // "TIMEOUT_ERROR", stable across releases and minification (derived from `name`, not the class)
}
```

## Bitcoin addresses from the same mnemonic

Derive the paired BTC account (what Leather/Xverse show next to your Stacks address) with no extra dependencies — BIP84 native segwit or BIP86 taproot, network-aware:

```ts
import { mnemonicToBitcoinKeys } from "@secondlayer/stacks/accounts";

const btc = mnemonicToBitcoinKeys(mnemonic, { type: "p2tr" });
btc.address; // bc1p…   (path m/86'/0'/0'/0/0)

mnemonicToBitcoinKeys(mnemonic, { type: "p2wpkh", network: "testnet" }).address; // tb1q…
```

Pure derivation — no Bitcoin transaction building or signing. The pubkey→address helpers (`publicKeyToP2wpkhAddress`, `publicKeyToP2trAddress`, `taprootTweakPubkey`) are exported from `@secondlayer/stacks/bitcoin`, validated against the BIP84/86/341 test vectors.

The sBTC extension uses the same machinery to derive the **signers' deposit address** straight from the on-chain registry — network-aware, so testnet gives `tb1p…` instead of a wrong-network address:

```ts
const client = createPublicClient({ chain: mainnet, transport: http() }).extend(sbtc());
await client.sbtc.getSignersAddress();   // bc1p… (derived from get-current-aggregate-pubkey)
await client.sbtc.getSignersPublicKey(); // 33-byte aggregate key
```

## PoX-5 Bitcoin Staking (SIP-045)

Epoch 4.0 activated at Bitcoin block 960,230 (2026-07-30). This module is pinned against the **final `pox-5` contract from stacks-core 4.0.0** — bonds, staking, L1 lockup scripts, signer grants, cycle math.

Activation gating is chain-reported, not hardcoded: `client.pox5.isActive()` / `getActivation()` read the node's `/v2/pox` `contract_versions` — no heights baked in, correct on any network, so integrations built today ship safely before the fork.

```ts
import { createWalletClient, http } from "@secondlayer/stacks";
import { mainnet } from "@secondlayer/stacks/chains";
import { Pc } from "@secondlayer/stacks/postconditions";
import { pox5 } from "@secondlayer/stacks/pox5";

const client = createWalletClient({ chain: mainnet, transport: http(), account })
  .extend(pox5());

if (await client.pox5.isActive()) {
  const txid = await client.pox5.stake({
    signerManager: "SP….signer-mgr",
    amountUstx: 100_000_000_000n,
    numCycles: 12,
    startBurnHeight: 960_231,
    fee: "low",
    postConditions: [
      Pc.principal(account.address).willSendEq(100_000_000_000n).ustxToLock(),
    ],
  });
  await client.waitForTransactionReceipt({ txid });
}
```

Every wallet action (`setupBond`, `registerForBond`, `stake`, `unstake`, `unstakeSbtc`, `claimRewards`, `grantSignerKey`, …) inherits fee tiers, nonce management, and typed errors from the client. `client.pox5.getStakerState(staker)` returns a staker's whole position (staker info, bond membership, custodied sBTC, current cycle) in one call (four parallel reads under the hood; Stacks nodes have no batch RPC, and `multicall` caps reads in flight at 8 by default via `concurrency`). Individual reads return typed JS values decoded via the module's committed pox-5 ABI (bigints, camelCase tuples, `null` for absent optionals), and every action's arguments are checked against that ABI at compile time.

### Off-chain L1 tooling — works before activation

- **Lockup scripts** — `buildLockupScript` / `buildLockupAddress` construct the CLTV + early-exit witness script and the network-aware P2WSH address a staker sends their L1 BTC to.
- **Signer grants** — `computeSignerGrantHash` (SIP-018 structured data) and `signSignerGrant` (65-byte RSV signature, the layout `grant-signer-key` expects), plus local `verifySignerGrant`.
- **Cycle math** — `burnHeightToRewardCycle`, `bondPeriodToBurnHeight`, `bondPhaseAtHeight`, … anchored on chain-reported `/v2/pox` parameters, nothing hardcoded.

The trust story: every wallet action is pinned against the boot contract interface in Clarinet simnet tests, and the script/grant-hash ports are byte-compared against the actual pox-5 contract read-onlys — not a hand-transcribed ABI.

## Nonce management

Stacks' `/v2/accounts` returns only the confirmed nonce — it ignores the mempool. Broadcasting several transactions from one account before the first confirms makes them reuse the same nonce, so every one after the first is rejected (`ConflictingNonceInMempool`). The usual workaround is tracking nonces by hand.

Attach a nonce manager and the SDK hands out sequential nonces across rapid broadcasts:

```ts
import { createWalletClient, http, createNonceManager } from "@secondlayer/stacks";
import { mainnet } from "@secondlayer/stacks/chains";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";

const client = createWalletClient({
  chain: mainnet,
  transport: http(),                  // any node — no Secondlayer dependency
  account: privateKeyToAccount(process.env.KEY!),
  nonceManager: createNonceManager(), // jsonRpcSource + in-memory store
});

// 20 back-to-back transfers → nonces n, n+1, …, n+19 — no collisions
await Promise.all(
  recipients.map((to) => client.transferStx({ to, amount: 1000n })),
);
```

Passing an explicit `nonce` always bypasses the manager. The defaults are node-agnostic and in-memory, with zero external dependencies. A send that fails before the node accepts it (fee estimate outage, `FeeTooLow`, transport error) hands its nonce back, so the next send reuses it instead of leaving a gap the mempool cannot chain past. Custom stores opt in by implementing `release(key, nonce)`; the bundled memory, Redis and Postgres stores already do.

### Multiple processes / smart wallets

The in-memory store is single-process. Backends that sign from one key across multiple workers (smart-wallet-as-a-service) need a shared, durable store. The reservation is atomic in the datastore, so it doubles as the cross-process lock and survives restarts:

```ts
import { createNonceManager, redisStore } from "@secondlayer/stacks";

const nonceManager = createNonceManager({
  store: redisStore({ redis: new Bun.RedisClient(process.env.REDIS_URL!) }),
});
```

`postgresStore({ sql })` works the same way. Bring your own client — no global `Bun` reference, so the store stays runtime-agnostic.

### Mempool-aware sources (optional)

By default the floor is the node's confirmed nonce. To make it mempool-aware, and to auto-fill the freed nonce of a dropped transaction, swap the source. `indexSource` reads your Secondlayer instance's mempool through the client transport (retries, timeout and `Authorization: Bearer` included), `hiroNonceSource` reads Hiro's, or bring your own pending feed with `mempoolAwareSource`:

```ts
import {
  createNonceManager,
  indexSource,
  startNonceReconciler,
} from "@secondlayer/stacks";

// indexSource({ baseUrl?, apiKey? }) | hiroNonceSource({ baseUrl }) | mempoolAwareSource({ getPending })
// baseUrl defaults to the transport URL; pass it when the transport is not your instance.
// A missing URL, a Hiro transport, or a host without /v1/index rejects instead of
// silently falling back to the confirmed nonce; a 5xx or timeout still degrades.
const source = indexSource();
const nonceManager = createNonceManager({ source });

// Optional: periodically heal silently-dropped txs (run in ONE process)
const reconciler = startNonceReconciler(nonceManager, {
  client,
  addresses: [account.address],
  source,
});
```

Everything here is opt-in. With no `source`/`store`, the manager depends only on your node.

## Bitcoin SPV (SIP-044)

**Prove a Bitcoin payment happened — inside a Stacks contract, with no oracle.**

SIP-044 ("Clarity 6", live since Stacks Epoch 4.0 activated 2026-07-30) lets a contract natively
verify that a Bitcoin transaction was mined — *SPV* (Simplified Payment
Verification), the proof technique Bitcoin light clients use. A contract can check
"BTC tx T paid Z sats to address Y in a confirmed block" without trusting an
indexer or oracle.

The catch: the built-ins (`get-bitcoin-tx-output?`, `verify-merkle-proof`) run
only *inside* a contract and demand precisely-shaped proof data — the right merkle
proof, internal byte order, witness stripped. This module does that off-chain prep
so you never run a node by hand or reverse a hash, and ships a reference contract
(`spv-adapter`, in `contracts/`) wired to the built-ins.

**What it unlocks** (it trust-minimizes *verification*, not *custody*):

- **BTC-settled escrow / OTC** — release sBTC, an NFT, or a loan only when a real BTC payment is proven on-chain.
- **BTC-L1 collateral** — prove a borrower's Bitcoin UTXO exists on L1 instead of trusting a price/existence oracle (Zest / Granite-style lending).
- **Atomic BTC ↔ sBTC / Runes swaps** — native SPV is uncapped, so multi-output Runes/BTC txs that blew past the old `clarity-bitcoin` limits now verify.
- **Trust-minimized sBTC** — deposits *proven* on-chain rather than only *asserted* by the signer set (aligns with SIP-028).

It's also the Bitcoin half of the [Secondlayer](https://secondlayer.tools) indexer:
our index already surfaces the `bitcoin_txid` on every sBTC deposit/withdrawal —
this module turns that correlation into an on-chain-verifiable proof.

```ts
import { createPublicClient, http } from "@secondlayer/stacks";
import { mainnet } from "@secondlayer/stacks/chains";
import {
  buildTxProof,
  bitcoinRpcSource,
  esploraSource,
  fallbackProofSource,
  verifyBitcoinPayment,
} from "@secondlayer/stacks/bitcoin";

const client = createPublicClient({ chain: mainnet, transport: http() });

// Trustless by default: the integrator's own node first, hosted fallback second.
const source = fallbackProofSource([
  bitcoinRpcSource({ url: "http://127.0.0.1:8332", auth: { username: "u", password: "p" } }),
  esploraSource({ url: "https://blockstream.info/api" }),
]);

// "release only when a real BTC payment to <addr> for <amount> is proven on-chain"
const result = await verifyBitcoinPayment(client, {
  txid: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
  source,
  vout: 0,
  expect: { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", amount: 5_000_000_000n },
});
// → { verified, mined, output, proof }
```

On mainnet `contract` is optional — it resolves the reference adapter,
`SP2M1DE95TS0QBM4K893X6ST49FFJ53CCX9CYWNVY.spv-adapter`, live since Epoch 4.0
activated (2026-07-30) and proven via a `was-tx-mined` golden-proof smoke test.
Stacks testnet has no Epoch 4.0, so the built-ins don't exist there: pass an
explicit `contract`, or point it at your own verifier.

Lower-level pieces are exported too: `parseBitcoinTx` / `buildMerkleProof` /
`merkleRoot` (proof construction), `encodeMerkleProofArgs` / `decodeTxOutput` /
`parseOutputScript` (Clarity codecs), and `bitcoinVerifier` / `isClarity6Active`
(the contract binding + activation gate).

The off-chain surface (proof construction, codecs, sources) works today against
live Bitcoin data. The on-chain verification calls the SIP-044 native built-ins,
live on mainnet since Clarity 6 / Epoch 4.0 activated at Bitcoin block 960,230
(2026-07-30), exported as `EPOCH_4_ACTIVATION_BURN_HEIGHT_MAINNET`.

### Run the on-chain side locally — no node

Clarinet ≥ 3.21 boots simnet at Epoch 4.0, so the `spv-adapter` reference
contract (`contracts/spv-adapter.clar`) both type-checks and *executes* the
built-ins today:

```bash
cd contracts && clarinet console      # in-memory simnet @ Epoch 4.0
# then: (contract-call? .spv-adapter get-tx-output 0x<rawtx> u0)
```

The SDK↔contract round-trip is covered in CI — it asserts the bytes this module
encodes are exactly what the built-ins accept:

```bash
bun test packages/stacks/src/bitcoin/__tests__/onchain.simnet.test.ts   # 7 pass
```

See `contracts/README.md` for the full local recipe.
**SPV trust-minimizes *verification*, not *custody*.**

## WalletConnect v2

Native WC v2 implementation — X25519 ECDH, AES-256-GCM envelope encryption, Ed25519 JWT relay auth. Zero cost if you don't import it, tree-shakes completely.

```ts
import { connect, setProvider } from "@secondlayer/stacks/connect";
import { WalletConnectProvider, showModal } from "@secondlayer/stacks/connect/walletconnect";

const wc = new WalletConnectProvider({
  projectId: "your-reown-project-id", // from cloud.reown.com
  metadata: { name: "My App", description: "...", url: "https://myapp.com", icons: [] },
});

// Restore existing session or pair new one
if (!wc.restore()) {
  const { uri, approval } = await wc.pair();
  showModal({ wcUri: uri, onClose: () => {} });
  await approval;
}

setProvider(wc);
const { addresses } = await connect();
```

The built-in modal shows browser extension wallets alongside the WC QR code — users pick whichever they prefer.

## Bundle Size

Measured with `bun build --minify --target=browser`, gzipped. Compared against stacks.js v7.3.1 + @stacks/connect v8.2.4.

```
                        @secondlayer/stacks    stacks.js + connect
                        ───────────────────    ───────────────────
SDK (gzipped)                      23.8 KB              189 KB
+ Connect                          +7.9 KB             +347 KB
+ WalletConnect v2                +25.5 KB          (included)
                        ───────────────────    ───────────────────
Total                              46.1 KB              536 KB  ← 11.6x
Dependencies                             8                 294  ← 37x
node_modules                          7 MB              351 MB  ← 50x
Polyfills needed                      none       Buffer, crypto
Packages to install                      1                  5+
```

8 runtime deps, all `@noble`/`@scure`: `@noble/hashes`, `@noble/secp256k1`, `@noble/curves`, `@noble/ciphers`, `@scure/base`, `@scure/bip32`, `@scure/bip39`, `@scure/btc-signer`. `ai` and `zod` are optional peers, pulled in only by the deprecated `/tools` entries.

Connect and WalletConnect are separate entry points — import only what you use. An app that just reads contracts pays 23.8 KB. Full wallet connection + WC v2 pays 46.1 KB. The equivalent stacks.js setup is 536 KB regardless.
