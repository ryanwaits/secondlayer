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

## Fee tiers

Every send action takes `fee` as an exact amount **or a named tier** — `'min' | 'low' | 'mid' | 'high'`. Tiers map to the node's three estimations; `'min'` is the minimum relay fee (1 uSTX per serialized byte), computed offline with no round-trip. Omitting `fee` estimates mid, and if the node can't produce an estimate (`NoEstimateAvailable`), the SDK falls back to `'min'` instead of failing.

```ts
await client.transferStx({ to, amount: 1000n, fee: "low" });
await client.callContract({ contract, functionName: "mint", fee: "min" });
```

## Wait for confirmation

`waitForTransactionReceipt` polls until a transaction is mined (optionally N confirmations deep) and returns a normalized receipt with the decoded Clarity result. It rejects with typed errors when the tx aborts (`TransactionAbortedError`, receipt attached), drops from the mempool (`TransactionDroppedError`), or times out — and it re-reads block placement every cycle, so reorgs don't strand the wait.

```ts
const { txid } = await client.callContract({ contract, functionName: "mint" });
const receipt = await client.waitForTransactionReceipt({ txid, confirmations: 2 });
receipt.result; // decoded ClarityValue

// or in one step:
const { receipt } = await sendTransaction(client, { transaction, wait: 2 });
```

Status reads are pluggable, like nonce sources: the default reads `/extended/v1/tx` on your transport host; `indexTxSource()` reads Secondlayer's index, which returns the chain tip in the same response — N-confirmation waits cost one request per poll. Rejection reasons are typed too: `BroadcastError.reason` is a literal union of all 26 stacks-node rejection strings (with `reasonData` and `txid` attached).

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

Passing an explicit `nonce` always bypasses the manager. The defaults are node-agnostic and in-memory — zero external dependencies.

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

By default the floor is the node's confirmed nonce. To make it mempool-aware — and to auto-fill the freed nonce of a dropped transaction — swap the source. `indexSource` reads Secondlayer's mempool, `hiroNonceSource` reads Hiro's, or bring your own pending feed with `mempoolAwareSource`:

```ts
import {
  createNonceManager,
  indexSource,
  startNonceReconciler,
} from "@secondlayer/stacks";

// indexSource() | hiroNonceSource({ baseUrl }) | mempoolAwareSource({ getPending })
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

SIP-044 ("Clarity 6", activating with Stacks Epoch 4.0) lets a contract natively
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
  contract: "SP….spv-adapter",            // the reference adapter (or your own verifier contract)
  expect: { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", amount: 5_000_000_000n },
});
// → { verified, mined, output, proof }
```

Lower-level pieces are exported too: `parseBitcoinTx` / `buildMerkleProof` /
`merkleRoot` (proof construction), `encodeMerkleProofArgs` / `decodeTxOutput` /
`parseOutputScript` (Clarity codecs), and `bitcoinVerifier` / `isClarity6Active`
(the contract binding + activation gate).

The off-chain surface (proof construction, codecs, sources) works today against
live Bitcoin data. The on-chain verification calls the SIP-044 native built-ins,
which exist once Clarity 6 / Epoch 4.0 is active.

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
Dependencies                             6                 294  ← 49x
node_modules                          7 MB              351 MB  ← 50x
Polyfills needed                      none       Buffer, crypto
Packages to install                      1                  5+
```

6 runtime deps, all `@noble`/`@scure`: `@noble/hashes`, `@noble/secp256k1`, `@noble/curves`, `@noble/ciphers`, `@scure/bip32`, `@scure/bip39`.

Connect and WalletConnect are separate entry points — import only what you use. An app that just reads contracts pays 23.8 KB. Full wallet connection + WC v2 pays 46.1 KB. The equivalent stacks.js setup is 536 KB regardless.
