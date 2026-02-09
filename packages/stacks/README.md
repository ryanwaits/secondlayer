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
| `@secondlayer/stacks/connect` | Wallet connection — browser extensions + `setProvider` |
| `@secondlayer/stacks/connect/walletconnect` | WalletConnect v2 — native relay, QR, modal |
| `@secondlayer/stacks/subscriptions` | `watchBlocks`, `watchMempool`, `watchTransaction` |
| `@secondlayer/stacks/utils` | Encoding, hashing, addresses, unit formatting |
| `@secondlayer/stacks/bns` | BNS name registration, resolution, zonefiles |
| `@secondlayer/stacks/pox` | PoX stacking — solo and delegated |
| `@secondlayer/stacks/stackingdao` | StackingDAO liquid staking (STX/stSTX) |

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
