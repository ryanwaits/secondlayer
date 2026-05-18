# `@secondlayer/stacks` — Core SDK Reference

A viem-style SDK for the Stacks blockchain. Zero polyfills, full tree-shaking, ESM-first. All amounts are `bigint` (`1_000_000n` = 1 STX). All addresses are c32-encoded principals.

## 1. Install + imports

```sh
bun add @secondlayer/stacks
```

```ts
// Most-used surface — re-exported from the root.
import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  mainnet,
  testnet,
  formatStx,
  parseStx,
  ZERO_ADDRESS,
} from "@secondlayer/stacks";

// Tree-shakable subpaths for everything else.
import { Cl } from "@secondlayer/stacks/clarity";
import { Pc } from "@secondlayer/stacks/postconditions";
import { getContract } from "@secondlayer/stacks/actions";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
```

The mental model is viem: a `Client` carries `{ chain, transport, account? }` and is composed with `extend(actions)`. `createPublicClient` and `createWalletClient` are pre-extended shortcuts.

## 2. Subpath exports

| Subpath | What it exports |
| --- | --- |
| `@secondlayer/stacks` | Re-exports of the most-used surface: clients, transports, chains, accounts (`providerToAccount`), units (`formatStx`/`parseStx`), constants, address utils, errors. |
| `@secondlayer/stacks/accounts` | `privateKeyToAccount`, `mnemonicToAccount`, `toAccount`, `providerToAccount`, `compressPrivateKey`, account types. |
| `@secondlayer/stacks/chains` | `mainnet`, `testnet`, `devnet`, `mocknet`, `defineChain`, `StacksChain`. |
| `@secondlayer/stacks/clarity` | `Cl` namespace, individual CV constructors, serialize/deserialize/prettyPrint, ABI types & helpers, `SIP010_ABI`/`SIP009_ABI`/`SIP013_ABI`, `jsToClarityValue`/`clarityValueToJS`. |
| `@secondlayer/stacks/actions` | `getContract` and standalone action functions (`readContract`, `getBalance`, etc.) for use without a decorator. |
| `@secondlayer/stacks/postconditions` | `Pc` fluent builder + post-condition types. |
| `@secondlayer/stacks/transactions` | Low-level tx primitives: `buildTokenTransfer`, `buildContractCall`, `buildContractDeploy`, signers, serializers, multi-sig helpers, enums, types. |
| `@secondlayer/stacks/subscriptions` | Watch actions + notification types. |
| `@secondlayer/stacks/utils` | All encoding/hash/address/keys/signature utilities + constants. |
| `@secondlayer/stacks/connect` | Browser wallet provider (`connect`, `getProvider`, `setProvider`, `isWalletInstalled`, `request`). |
| `@secondlayer/stacks/connect/walletconnect` | `WalletConnectProvider` for WalletConnect v2. |
| `@secondlayer/stacks/tools` | Vercel AI SDK tools (`createStacksTools` factory + bare exports). |
| `@secondlayer/stacks/tools/btc` | Bitcoin-flavored AI SDK tools. |
| `@secondlayer/stacks/bns` | BNS extension — see `stacks-extensions.md`. |
| `@secondlayer/stacks/pox` | PoX-4 extension — see `stacks-extensions.md`. |
| `@secondlayer/stacks/sbtc` | sBTC extension — see `stacks-extensions.md`. |
| `@secondlayer/stacks/stackingdao` | StackingDAO extension — see `stacks-extensions.md`. |

## 3. Clients

### `createPublicClient(config)`

Read-only client, pre-extended with `PublicActions`.

```ts
type PublicClientConfig = {
  chain?: StacksChain;
  transport: TransportFactory;
};

function createPublicClient(
  config: PublicClientConfig,
): Client<PublicActions> & PublicActions;
```

```ts
import { createPublicClient, http, mainnet } from "@secondlayer/stacks";

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
});

const balance = await client.getBalance({
  address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
});
```

### `createWalletClient(config)`

Account-bound client for signing and broadcasting. `account` is required.

```ts
type WalletClientConfig = {
  chain?: StacksChain;
  transport: TransportFactory;
  account: Account;  // LocalAccount | CustomAccount | ProviderAccount
};

function createWalletClient(
  config: WalletClientConfig,
): Client<WalletActions> & WalletActions & { account: Account };
```

```ts
import { createWalletClient, http, mainnet } from "@secondlayer/stacks";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";

const wallet = createWalletClient({
  chain: mainnet,
  transport: http(),
  account: privateKeyToAccount("0x..."),
});

const txid = await wallet.transferStx({
  to: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  amount: 1_000_000n,  // 1 STX
});
```

### `createClient(config)` + `.extend()`

Base client. Compose your own action sets.

```ts
type ClientConfig = {
  chain?: StacksChain;
  transport: TransportFactory;
  account?: Account;
};

type Client<TExtended = {}> = {
  chain?: StacksChain;
  account?: Account;
  transport: Transport;
  request: RequestFn;
  extend: <TNew>(fn: (client: Client<TExtended>) => TNew) => Client<TExtended & TNew> & TNew;
} & TExtended;
```

```ts
import { createClient, publicActions, walletActions, http, mainnet } from "@secondlayer/stacks";

const client = createClient({ chain: mainnet, transport: http() })
  .extend(publicActions)
  .extend(walletActions);
```

`extend` is chainable, returns a new client; the base keys (`chain`, `account`, `transport`, `request`, `extend`) are never overwritten.

### `createMultiSigClient(config)`

For m-of-n multi-sig flows. Builds unsigned transactions; each party signs; broadcast auto-finalizes.

```ts
type MultiSigClientConfig = {
  chain?: StacksChain;
  transport: TransportFactory;
  signers: string[];           // hex public keys
  requiredSignatures: number;
  hashMode?: MultiSigHashMode; // default P2SH
};

type MultiSigClient = Client<MultiSigActions> & MultiSigActions;

type MultiSigActions = {
  transferStx: (p: MultiSigTransferStxParams) => Promise<StacksTransaction>;
  callContract: (p: MultiSigCallContractParams) => Promise<StacksTransaction>;
  deployContract: (p: MultiSigDeployContractParams) => Promise<StacksTransaction>;
  sendTransaction: (p: { transaction: StacksTransaction; attachment?: Uint8Array | string }) => Promise<{ txid: string }>;
};
```

```ts
import { createMultiSigClient, http, mainnet } from "@secondlayer/stacks";

const ms = createMultiSigClient({
  chain: mainnet,
  transport: http(),
  signers: ["02ab...", "03cd...", "02ef..."],
  requiredSignatures: 2,
});

// Build unsigned. Each signer then signs with `signMultiSigWithAccount`.
const unsigned = await ms.transferStx({
  to: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  amount: 1_000_000n,
});

// After collecting signatures, broadcast (auto-finalizes ordering).
await ms.sendTransaction({ transaction: signed });
```

## 4. Transports

```ts
type TransportConfig = {
  url?: string;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
  fetchOptions?: RequestInit;
  apiKey?: string;
};

type Transport = {
  type: string;
  request: RequestFn;
  config: TransportConfig;
  destroy?: () => void;
};

type TransportFactory = (params?: { chain?: StacksChain }) => Transport;
```

### `http(url?, config?)`

Default. Falls back to `chain.rpcUrls.default.http[0]`, then `http://localhost:3999`.

```ts
import { http, mainnet, createPublicClient } from "@secondlayer/stacks";

const client = createPublicClient({
  chain: mainnet,
  transport: http("https://api.mainnet.hiro.so", {
    apiKey: process.env.HIRO_API_KEY,
    timeout: 30_000,
    retryCount: 3,
    retryDelay: 250,
  }),
});
```

### `webSocket(url?, config?)`

Required for `watch*` actions. Re-uses RPC URL for HTTP requests; derives `ws://…/extended/v1/ws` if no WS URL is configured on the chain.

```ts
type WebSocketTransportConfig = TransportConfig & {
  url?: string;
  reconnect?: boolean;              // default true
  reconnectMaxAttempts?: number;    // default 10
  reconnectBaseDelay?: number;      // default 1000 (ms), exponential backoff
};
```

```ts
import { webSocket, mainnet, createPublicClient } from "@secondlayer/stacks";

const client = createPublicClient({
  chain: mainnet,
  transport: webSocket(),
});

const sub = await client.watchBlocks({
  onBlock: (block) => console.log(block.height),
});
```

### `fallback([...transports])`

Tries each transport in order; first success wins.

```ts
import { fallback, http } from "@secondlayer/stacks";

const transport = fallback([
  http("https://primary.example.com"),
  http("https://backup.example.com"),
]);
```

### `custom({ request })`

Wrap a user-provided `RequestFn`.

```ts
import { custom } from "@secondlayer/stacks";

const transport = custom({
  request: async (path, options) => {
    // ...
  },
});
```

## 5. Chains

```ts
type StacksChain = {
  id: number;
  name: string;
  network: "mainnet" | "testnet";
  transactionVersion: number;
  peerNetworkId: number;
  addressVersion: { singleSig: number; multiSig: number };
  magicBytes: string;
  bootAddress: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: { default: { http: string[]; ws?: string[] } };
  blockExplorers?: { default: { name: string; url: string } };
};
```

Pre-defined:

| Chain | `id` | `addressVersion` | Default RPC |
| --- | --- | --- | --- |
| `mainnet` | `0x00000001` | `{ singleSig: 22, multiSig: 20 }` | `https://api.mainnet.hiro.so` |
| `testnet` | `0x80000000` | `{ singleSig: 26, multiSig: 21 }` | `https://api.testnet.hiro.so` |
| `devnet` | `0x80000000` | `{ singleSig: 26, multiSig: 21 }` | `http://localhost:3999` |
| `mocknet` | `0x80000000` | `{ singleSig: 26, multiSig: 21 }` | `http://localhost:3999` |

### `defineChain(chain)`

Identity helper for full type-inference on a custom chain.

```ts
import { defineChain } from "@secondlayer/stacks";

const myChain = defineChain({
  id: 0x80000000,
  name: "My Stacks Testnet",
  network: "testnet",
  transactionVersion: 0x80,
  peerNetworkId: 0xff000000,
  addressVersion: { singleSig: 26, multiSig: 21 },
  magicBytes: "T2",
  bootAddress: "ST000000000000000000002AMW42H",
  nativeCurrency: { name: "Stacks", symbol: "STX", decimals: 6 },
  rpcUrls: {
    default: {
      http: ["https://my-rpc.example.com"],
      ws: ["wss://my-rpc.example.com/extended/v1/ws"],
    },
  },
});
```

## 6. Accounts

```ts
type Account = LocalAccount | CustomAccount | ProviderAccount;

type LocalAccount = {
  type: "local";
  address: string;
  publicKey: string;  // compressed hex
  sign(hash: Uint8Array): Uint8Array;          // 65-byte VRS
  signMessage(message: string | Uint8Array): string;
};

type CustomAccount = {
  type: "custom";
  address: string;
  publicKey: string;
  sign(hash: Uint8Array): Promise<Uint8Array> | Uint8Array;
};

type StacksProvider = {
  request(method: string, params?: any): Promise<any>;
};

type ProviderAccount = {
  type: "provider";
  address: string;
  publicKey: string;
  provider: StacksProvider;
};
```

### `privateKeyToAccount(privateKey, options?)`

```ts
function privateKeyToAccount(
  privateKey: string | Uint8Array,
  options?: { addressVersion?: number },
): LocalAccount;
```

Defaults `addressVersion` to `22` (mainnet single-sig). Use `26` for testnet.

```ts
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import { AddressVersion } from "@secondlayer/stacks";

const mainnetAcct = privateKeyToAccount("0xabc..."); // SP…
const testnetAcct = privateKeyToAccount("0xabc...", {
  addressVersion: AddressVersion.TestnetSingleSig, // 26
}); // ST…
```

### `mnemonicToAccount(mnemonic, options?)`

Derives at `m/44'/5757'/0'/0/{accountIndex}`.

```ts
function mnemonicToAccount(
  mnemonic: string,
  options?: { accountIndex?: number; addressVersion?: number },
): LocalAccount;
```

```ts
import { mnemonicToAccount } from "@secondlayer/stacks/accounts";

const acct = mnemonicToAccount("twelve word seed phrase here ...", {
  accountIndex: 0,
});
```

### `providerToAccount(provider)`

Async — calls `stx_getAddresses` on the browser wallet.

```ts
import { providerToAccount, getProvider } from "@secondlayer/stacks/connect";

const account = await providerToAccount(getProvider());
const wallet = createWalletClient({ chain: mainnet, transport: http(), account });
```

### `compressPrivateKey(key)`

Appends `0x01` suffix if not already 33 bytes (the Stacks "compressed" convention).

## 7. Public actions

All methods are on the `PublicActions` shape attached by `publicActions` decorator. Available on any client created with `createPublicClient` or extended with `publicActions`.

| Method | Signature | Description |
| --- | --- | --- |
| `getNonce` | `(p: { address: string }) => Promise<bigint>` | Account nonce from `/v2/accounts/{addr}`. |
| `getBalance` | `(p: { address: string }) => Promise<bigint>` | STX balance (micro-STX). |
| `getAccountInfo` | `(p: { address: string }) => Promise<AccountInfo>` | Balance + nonce + proofs (`?proof=1`). |
| `getBlock` | `(p?: { height?: number; hash?: string }) => Promise<any>` | Block by height/hash, or latest if neither. |
| `getBlockHeight` | `() => Promise<number>` | Current `stacks_tip_height` from `/v2/info`. |
| `readContract` | `(p: { contract, functionName, args?, sender? }) => Promise<ClarityValue>` | Read-only contract call. Throws on failure. |
| `getContractAbi` | `(p: { contract: string }) => Promise<any>` | Raw ABI JSON from `/v2/contracts/interface`. |
| `getMapEntry` | `(p: { contract, mapName, key }) => Promise<ClarityValue>` | Reads `(map-get?)`-style value. |
| `estimateFee` | `(p: { transaction }) => Promise<FeeEstimation[]>` | Returns `[low, medium, high]` (`{ feeRate, fee }`). |
| `multicall` | `(p: MulticallParams) => Promise<MulticallResult>` | Batch of `readContract`. `allowFailure` (default `true`) returns `{ status, result/error }[]`. |
| `simulateCall` | `(p: SimulateCallParams) => Promise<SimulateCallResult>` | Simulate a read-only call; reports `writesDetected` if the function mutates state. |
| `simulateTransaction` | `(p: { transaction, sender?, tip? }) => Promise<SimulateTransactionResult>` | Simulate any tx + fee estimates. Discriminated by `type: "contract-call" \| "token-transfer" \| "contract-deploy"`. |
| `watchBlocks` | `(p: { onBlock }) => Promise<Subscription>` | Requires WebSocket transport. |
| `watchMempool` | `(p: { onTransaction }) => Promise<Subscription>` | Mempool stream. |
| `watchTransaction` | `(p: { txId, onUpdate }) => Promise<Subscription>` | Watch one tx. |
| `watchAddress` | `(p: { address, onTransaction }) => Promise<Subscription>` | Per-address tx updates. |
| `watchAddressBalance` | `(p: { address, onBalance }) => Promise<Subscription>` | Per-address balance updates. |
| `watchNftEvent` | `(p: { onEvent, assetIdentifier?, value? }) => Promise<Subscription>` | NFT events (asset, collection, or specific token). |

Types:

```ts
type ReadContractParams = {
  contract: string;       // "SP....name"
  functionName: string;
  args?: ClarityValue[];
  sender?: string;
};

type AccountInfo = { balance: bigint; nonce: bigint; balanceProof: string; nonceProof: string };

type FeeEstimation = { feeRate: number; fee: number };

type SimulateCallResult =
  | { success: true; result: ClarityValue }
  | { success: false; error: SimulationError };

type MulticallCall = { contract: string; functionName: string; args?: ClarityValue[]; sender?: string };
type MulticallParams<T extends boolean = true> = { calls: readonly MulticallCall[]; allowFailure?: T };
type MulticallResult<T extends boolean> = T extends true
  ? ({ status: "success"; result: ClarityValue } | { status: "failure"; error: Error })[]
  : ClarityValue[];
```

Example:

```ts
const supply = await client.readContract({
  contract: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.usda-token",
  functionName: "get-total-supply",
});

const [balanceA, balanceB] = await client.multicall({
  allowFailure: false,
  calls: [
    {
      contract: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.usda-token",
      functionName: "get-balance",
      args: [Cl.principal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")],
    },
    {
      contract: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.usda-token",
      functionName: "get-balance",
      args: [Cl.principal("SP000000000000000000002Q6VF78")],
    },
  ],
});
```

## 8. Wallet actions

Attached by `walletActions` decorator. All require `client.account`.

| Method | Signature | Description |
| --- | --- | --- |
| `sendTransaction` | `(p: { transaction, attachment? }) => Promise<{ txid: string }>` | Broadcasts a signed `StacksTransaction`. Throws `BroadcastError` on rejection. |
| `signTransaction` | `(p: { transaction, signers? }) => Promise<StacksTransaction>` | Signs with `client.account`. Auto-detects multi-sig from `_multisig` metadata; provider accounts delegate to the wallet. |
| `transferStx` | `(p: TransferStxParams) => Promise<string>` | Build + sign + broadcast STX transfer. Returns `txid`. |
| `callContract` | `(p: CallContractParams) => Promise<string>` | Build + sign + broadcast a contract call. Returns `txid`. |
| `deployContract` | `(p: DeployContractParams) => Promise<string>` | Build + sign + broadcast a contract deploy. Returns `txid`. |
| `signMessage` | `(p: { message, domain? }) => Promise<string>` | SIP-018 signed message. `domain` makes it a structured signature; otherwise raw. |
| `sponsorTransaction` | `(p: { transaction, fee?, nonce? }) => Promise<StacksTransaction>` | Sets sponsor spending condition + signs as sponsor. Tx auth must be `Sponsored`. Not supported on `ProviderAccount`. |

Types:

```ts
type TransferStxParams = {
  to: string;
  amount: IntegerType;            // bigint | number | string
  memo?: string;
  fee?: IntegerType;              // auto-estimated if omitted
  nonce?: IntegerType;            // auto-fetched if omitted
  postConditionMode?: "allow" | "deny";  // default "deny"
  postConditions?: PostCondition[];
};

type CallContractParams = {
  contract: string;               // "address.name"
  functionName: string;
  functionArgs?: ClarityValue[];
  fee?: IntegerType;
  nonce?: IntegerType;
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
};

type DeployContractParams = {
  contractName: string;
  codeBody: string;
  clarityVersion?: ClarityVersion;
  fee?: IntegerType;
  nonce?: IntegerType;
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
};

type SignMessageParams = {
  message: string | ClarityValue;
  domain?: { name: string; version: string; chainId: number };
};
```

> **`postConditionMode` defaults to `"deny"`** for all build/call/deploy paths. That means: if the transaction asserts a transfer not listed in `postConditions`, broadcast will succeed but the tx will abort on chain. Use `"allow"` only when you intentionally want to skip the assertion check.

Example:

```ts
import { Pc } from "@secondlayer/stacks/postconditions";

const txid = await wallet.callContract({
  contract: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.usda-token",
  functionName: "transfer",
  functionArgs: [
    Cl.uint(1_000_000n),
    Cl.principal(wallet.account.address),
    Cl.principal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"),
    Cl.none(),
  ],
  postConditions: [
    Pc.principal(wallet.account.address)
      .willSendEq(1_000_000n)
      .ft("SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.usda-token", "usda"),
  ],
});
```

## 9. `Cl` namespace

Build Clarity values for contract calls. Every constructor returns a discriminated-union `ClarityValue`.

| Constructor | Signature | Output shape |
| --- | --- | --- |
| `Cl.int(v)` | `(IntegerType) => IntCV` | `{ type: "int", value: bigint }` |
| `Cl.uint(v)` | `(IntegerType) => UIntCV` | `{ type: "uint", value: bigint }` |
| `Cl.bool(v)` | `(boolean) => BooleanCV` | `{ type: "true" }` or `{ type: "false" }` |
| `Cl.principal(addr)` | `(string) => StandardPrincipalCV \| ContractPrincipalCV` | Splits on `.` — auto-detects contract vs standard. |
| `Cl.address(addr)` | Alias of `Cl.principal`. | |
| `Cl.standardPrincipal(addr)` | `(string) => StandardPrincipalCV` | `{ type: "address", value: "SP…" }` |
| `Cl.contractPrincipal(addr, name)` | `(string, string) => ContractPrincipalCV` | `{ type: "contract", value: "SP….name" }` |
| `Cl.buffer(bytes)` | `(Uint8Array) => BufferCV` | `{ type: "buffer", value: hex }` (max 1 MB) |
| `Cl.bufferFromHex(hex)` | `(string) => BufferCV` | |
| `Cl.bufferFromAscii(s)` | `(string) => BufferCV` | |
| `Cl.bufferFromUtf8(s)` | `(string) => BufferCV` | |
| `Cl.none()` | `() => NoneCV` | `{ type: "none" }` |
| `Cl.some(v)` | `(ClarityValue) => SomeCV` | `{ type: "some", value: ... }` |
| `Cl.ok(v)` | `(ClarityValue) => ResponseOkCV` | `{ type: "ok", value: ... }` |
| `Cl.error(v)` | `(ClarityValue) => ResponseErrorCV` | `{ type: "err", value: ... }` |
| `Cl.list(arr)` | `(ClarityValue[]) => ListCV` | `{ type: "list", value: [...] }` |
| `Cl.tuple(obj)` | `(TupleData) => TupleCV` | `{ type: "tuple", value: {...} }` — keys must be valid Clarity names. |
| `Cl.stringAscii(s)` | `(string) => StringAsciiCV` | `{ type: "ascii", value: s }` |
| `Cl.stringUtf8(s)` | `(string) => StringUtf8CV` | `{ type: "utf8", value: s }` |
| `Cl.serialize(v)` | `(ClarityValue) => string` | Hex of binary wire format (SIP-005). |
| `Cl.deserialize(bytes)` | `(Uint8Array) => ClarityValue` | Decode wire bytes. |

Examples:

```ts
Cl.uint(42)
// => { type: "uint", value: 42n }

Cl.tuple({
  "amount": Cl.uint(1_000_000n),
  "recipient": Cl.principal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"),
})
// => { type: "tuple", value: { amount: {...}, recipient: {...} } }

Cl.some(Cl.bufferFromAscii("hello"))
// => { type: "some", value: { type: "buffer", value: "68656c6c6f" } }
```

Standalone constructors are also exported: `intCV`, `uintCV`, `boolCV`, `trueCV`, `falseCV`, `bufferCV`, `noneCV`, `someCV`, `responseOkCV`, `responseErrorCV`, `standardPrincipalCV`, `contractPrincipalCV`, `listCV`, `tupleCV`, `stringAsciiCV`, `stringUtf8CV`.

Bounds enforced: `uint` ≤ `2^128 - 1`, `int` in `[-2^127, 2^127 - 1]`, `buffer` ≤ 1 MB, contract names < 128 bytes.

### Serialize / deserialize / prettyPrint

```ts
import { serializeCV, serializeCVBytes, deserializeCV, deserializeCVBytes, prettyPrint, cvToJSON, cvToValue } from "@secondlayer/stacks/clarity";

const hex = Cl.serialize(Cl.uint(42));              // "0100000000000000000000000000000002a"
const cv  = Cl.deserialize(hexToBytes(hex));        // { type: "uint", value: 42n }

prettyPrint(Cl.tuple({ a: Cl.uint(1) }));            // "(tuple (a u1))"
prettyPrint(Cl.bufferFromAscii("hi"), "tryAscii");   // "\"hi\""
```

## 10. `Pc` post-conditions

Fluent builder for the three Stacks post-condition kinds. Start with a principal (or `Pc.origin()`), pick a comparator, then call the asset method.

```ts
const Pc = {
  principal(address: string): PartialPcWithPrincipal,
  origin(): PartialPcWithPrincipal,
};
```

Comparators (fungible — STX & FT):

| Method | Asset method | Meaning |
| --- | --- | --- |
| `willSendEq(amount)` | `.ustx()` / `.ft(id, name)` | Sends exactly `amount`. |
| `willSendGt(amount)` | `.ustx()` / `.ft(...)` | Sends > `amount`. |
| `willSendGte(amount)` | `.ustx()` / `.ft(...)` | Sends ≥ `amount`. |
| `willSendLt(amount)` | `.ustx()` / `.ft(...)` | Sends < `amount`. |
| `willSendLte(amount)` | `.ustx()` / `.ft(...)` | Sends ≤ `amount`. |

Comparators (non-fungible — NFT):

| Method | Asset method | Meaning |
| --- | --- | --- |
| `willSendAsset()` | `.nft(...)` | Sends the asset. |
| `willNotSendAsset()` | `.nft(...)` | Does not send the asset. |

```ts
// STX
Pc.principal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
  .willSendEq(1_000_000n)
  .ustx();
// => { type: "stx-postcondition", address: "...", condition: "eq", amount: "1000000" }

// FT (USDA)
Pc.principal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
  .willSendLte(5_000_000n)
  .ft("SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.usda-token", "usda");
// => { type: "ft-postcondition", asset: "SP3K8BC0PP....usda-token::usda", ... }

// NFT — token id is a ClarityValue
Pc.principal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
  .willSendAsset()
  .nft(
    "SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.boom-nfts",
    "boom",
    Cl.uint(42n),
  );

// Two-arg form ("addr.contract::token" + assetId)
Pc.principal(owner)
  .willSendAsset()
  .nft("SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.boom-nfts::boom", Cl.uint(42n));

// "origin" — the tx sender
Pc.origin().willSendEq(1_000_000n).ustx();
```

`PostConditionMode`:

- `"deny"` (default) — only the listed transfers are allowed; any additional asset movement aborts the tx.
- `"allow"` — assertions are skipped. Use only when the called function may legitimately move assets you cannot enumerate up-front.

## 11. `getContract` — typed ABIs

Wraps a contract with a strongly-typed `.read.*`, `.call.*`, and `.maps.*` interface derived from its ABI.

```ts
type GetContractParams<C extends AbiContract> = {
  client: Client;
  address: string;
  name: string;
  abi: C;
};

type ContractInstance<C extends AbiContract> = {
  read: ReadMethods<C>;   // read-only functions
  call: CallMethods<C>;   // public functions (returns txid)
  maps: MapMethods<C>;    // contract data maps
};

type ContractCallOptions = {
  fee?: IntegerType;
  nonce?: IntegerType;
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
};
```

Behavior:

- **Kebab → camel conversion**: Clarity uses `kebab-case`; methods are exposed as `camelCase`. `get-balance` → `getBalance`, `name-claim-fast` → `nameClaimFast`.
- **Raw JS args**: pass `bigint` for `uint128`/`int128`, `Uint8Array` for `buff`, `string` for principals — `jsToClarityValue` converts to the right CV using the ABI.
- **Auto unwrap of `(response …)`**: read methods unwrap `(ok v)` → `v`. On `(err e)` they throw `ContractResponseError` with `errorValue`.
- **Maps return `null` on miss**: `(map-get?)` returning `(none)` becomes `null`.
- **`.call.*` returns the txid** (`Promise<string>`). Options go in the second arg.

```ts
import { createWalletClient, http, mainnet } from "@secondlayer/stacks";
import { getContract } from "@secondlayer/stacks/actions";
import { SIP010_ABI } from "@secondlayer/stacks/clarity";
import { Cl } from "@secondlayer/stacks/clarity";
import { Pc } from "@secondlayer/stacks/postconditions";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";

const wallet = createWalletClient({
  chain: mainnet,
  transport: http(),
  account: privateKeyToAccount(process.env.PRIVATE_KEY!),
});

const usda = getContract({
  client: wallet,
  address: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9",
  name: "usda-token",
  abi: SIP010_ABI,
});

// Read — auto-unwrapped from (ok ...)
const supply = await usda.read.getTotalSupply({});       // bigint
const balance = await usda.read.getBalance({
  account: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
}); // bigint

// Call — second arg is options
const txid = await usda.call.transfer(
  {
    amount: 1_000_000n,
    sender: wallet.account.address,
    recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    memo: { type: "none" },  // Cl.none() also works
  },
  {
    postConditions: [
      Pc.principal(wallet.account.address)
        .willSendEq(1_000_000n)
        .ft("SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.usda-token", "usda"),
    ],
  },
);
```

Argument names accept both the original kebab-case (`"get-balance"`'s `account` arg) and camelCase (e.g. `tokenId` for an ABI arg `token-id`).

## 12. Standard ABIs

Re-exported from `@secondlayer/stacks/clarity`:

| ABI | Standard | Notes |
| --- | --- | --- |
| `SIP010_ABI` | Fungible Token | `transfer`, `get-balance`, `get-total-supply`, `get-name`, `get-symbol`, `get-decimals`, `get-token-uri` + fungible token `token`. |
| `SIP009_ABI` | Non-Fungible Token | `transfer`, `get-last-token-id`, `get-token-uri`, `get-owner`. |
| `SIP013_ABI` | Semi-Fungible Token | Multi-token (per-id supplies + transfers). |

Lowercase aliases also exported: `sip010Abi`, `sip009Abi`, `sip013Abi`.

```ts
import { SIP009_ABI } from "@secondlayer/stacks/clarity";

const nft = getContract({
  client,
  address: "SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C",
  name: "boom-nfts",
  abi: SIP009_ABI,
});

const owner = await nft.read.getOwner({ id: 42n }); // string principal
```

## 13. Transactions (low-level)

For manual assembly without `transferStx` / `callContract`. Imported from `@secondlayer/stacks/transactions`.

### Build

```ts
function buildTokenTransfer(opts: BuildTokenTransferOptions): StacksTransaction;
function buildContractCall(opts: BuildContractCallOptions): StacksTransaction;
function buildContractDeploy(opts: BuildContractDeployOptions): StacksTransaction;
```

Shared options:

```ts
type BuildTokenTransferOptions = {
  recipient: string;
  amount: IntegerType;
  memo?: string;
  fee: IntegerType;
  nonce: IntegerType;
  publicKey?: string;            // single-sig
  publicKeys?: string[];         // multi-sig
  signaturesRequired?: number;   // multi-sig (m of n)
  hashMode?: MultiSigHashMode;
  chain?: StacksChain;
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
  sponsored?: boolean;
};
```

`BuildContractCallOptions` swaps `recipient/amount/memo` for `{ contractAddress, contractName, functionName, functionArgs }`. `BuildContractDeployOptions` uses `{ contractName, codeBody, clarityVersion? }`.

### Sign

```ts
// With a raw private key (sync, single-sig)
signTransaction(tx, privateKey): StacksTransaction

// With an account (async, single-sig)
signTransactionWithAccount(tx, account): Promise<StacksTransaction>

// Sponsor signing
signSponsor(tx, privateKey): StacksTransaction
signSponsorWithAccount(tx, account): Promise<StacksTransaction>

// Misc
signBegin(tx): string                  // initial sighash
getTransactionId(tx): string            // serialized txid (post-sign)
getOriginSigHash(tx): string            // for sponsor flow
```

### Serialize / deserialize

```ts
import {
  serializeTransaction,        // Uint8Array
  serializeTransactionHex,     // string
  deserializeTransaction,      // accepts hex or bytes
} from "@secondlayer/stacks/transactions";
```

### Multi-sig

```ts
makeMultiSigAddress(publicKeys, signaturesRequired, chain?): string

createMultiSigSpendingCondition(
  publicKeys, signaturesRequired, nonce, fee, hashMode?
): MultiSigSpendingCondition

signMultiSig(tx, privateKey, publicKeys): StacksTransaction
signMultiSigWithAccount(tx, account, publicKeys): Promise<StacksTransaction>

finalizeMultiSig(tx, publicKeys): StacksTransaction       // orders fields for broadcast
combineMultiSigSignatures(tx, ...signedCopies): StacksTransaction
replayMultiSigSigHash(tx): string
isNonSequential(hashMode): boolean                         // SIP-027
```

Enums and types also exported: `AuthType`, `PayloadType`, `ClarityVersion`, `AnchorMode`, `PostConditionModeWire`, `AddressHashMode`, `PubKeyEncoding`, `FungibleConditionCode`, `NonFungibleConditionCode`, `AssetType`, `AuthFieldType`, `TenureChangeCause`, plus type-only `StacksTransaction`, `Authorization`, `SpendingCondition`, `*Payload`, `PostConditionWire`, `TransactionAuthField`.

## 14. Subscriptions (WebSocket)

All require a `webSocket()` transport. Each returns a `Subscription` handle.

```ts
type Subscription = { unsubscribe: () => void };
```

| Action | Params | Notification payload |
| --- | --- | --- |
| `watchBlocks` | `{ onBlock: (b: BlockNotification) => void }` | `BlockNotification` (height, hash, txs, …) |
| `watchMempool` | `{ onTransaction: (tx: MempoolNotification) => void }` | `MempoolNotification` (tx_id, type, fee_rate, sender_address, …) |
| `watchTransaction` | `{ txId: string; onUpdate: (u: TxUpdateNotification) => void }` | `TxUpdateNotification` (tx_status, block_height, tx_result, …) |
| `watchAddress` | `{ address: string; onTransaction: (tx: AddressTxNotification) => void }` | `AddressTxNotification` (stx/ft/nft transfers) |
| `watchAddressBalance` | `{ address: string; onBalance: (b: AddressBalanceNotification) => void }` | `AddressBalanceNotification` (balance, locked, totals) |
| `watchNftEvent` | `{ onEvent, assetIdentifier?, value? }` | `NftEventNotification`. Routing: both → `nft_event`; only `assetIdentifier` → `nft_collection_event`; neither → `nft_event`. |

```ts
import { createPublicClient, webSocket, mainnet } from "@secondlayer/stacks";

const client = createPublicClient({ chain: mainnet, transport: webSocket() });

const sub = await client.watchAddress({
  address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  onTransaction: (tx) => console.log(tx.tx_id, tx.stx_sent, tx.stx_received),
});

// Later
sub.unsubscribe();
```

The WebSocket channel auto-reconnects (exponential backoff up to `reconnectMaxAttempts`) and resubscribes on reconnect. Subscriptions are deduplicated by (event, tx_id, address, asset_identifier, value) — multiple callbacks against the same key share one upstream subscription.

## 15. Utils

All re-exported from `@secondlayer/stacks/utils` (a few are also on the root entry).

**Units**:

```ts
formatStx(1_000_000n)          // "1"
formatStx(1_500_000n)          // "1.5"
parseStx("1.5")                // 1500000n
formatUnits(1_000_000n, 6)     // "1"
parseUnits("1.5", 6)           // 1500000n
```

**Constants**: `MICROSTX_PER_STX` (`1_000_000n`), `MAX_U128`, `MAX_I128`, `MIN_I128`, `ZERO_ADDRESS` (`"SP000000000000000000002Q6VF78"`), `TESTNET_ZERO_ADDRESS` (`"ST000000000000000000002AMW42H"`), `AddressVersion` (`{ MainnetSingleSig: 22, MainnetMultiSig: 20, TestnetSingleSig: 26, TestnetMultiSig: 21 }`).

**Address**:

```ts
isValidAddress(addr): boolean
isAddressEqual(a, b): boolean                  // version-aware
parseContractId("SP....name"): [string, string]
getContractAddress(deployer, name): string     // validates both
addressToVersion(addr): number                 // 22 | 20 | 26 | 21
isClarityName(name): boolean
c32address(version, hash160Hex): string
c32addressDecode(address): [number, string]    // [version, hash160 hex]
```

**Hash**:

```ts
hash160(bytes): Uint8Array               // RIPEMD160(SHA256(input))
sha256(bytes): Uint8Array
sha512_256(bytes): Uint8Array
ripemd160(bytes): Uint8Array
txidFromBytes(bytes): string             // SHA-512/256 hex
hashP2PKH(pubkey): string                // hash160 hex
```

**Keys**: `compressPublicKey`, `uncompressPublicKey`, `isCompressedPublicKey`, `randomBytes(length?)`.

**Signature**: `parseSignature(hex)`, `serializeSignature(sig)`, `signatureVrsToRsv`, `signatureRsvToVrs`, `recoverPublicKey`, `recoverAddress`, `verifySignature`, `verifyMessageSignature`, type `RecoverableSignature`.

**Encoding**: `bytesToHex`, `hexToBytes`, `with0x`, `without0x`, `utf8ToBytes`, `bytesToUtf8`, `asciiToBytes`, `bytesToAscii`, `concatBytes`, `intToBigInt`, `intToBytes`, `bigIntToBytes`, `intToHex`, `toTwos`, `fromTwos`, `bytesToTwosBigInt`, `writeUInt32BE`, `readUInt32BE`, `writeUInt16BE`, `readUInt16BE`, `writeUInt8`, type `IntegerType` (`bigint | number | string`).

## 16. Errors

All extend `BaseError`. Shape:

```ts
class BaseError extends Error {
  shortMessage: string;
  details?: string;
  constructor(shortMessage: string, options?: { cause?: Error; details?: string });
  toJSON(): { name, message, shortMessage, details, cause };
}
```

| Class | When it fires |
| --- | --- |
| `BaseError` | Root of every SDK error. `name = "StacksError"`. |
| `TransactionError` | Generic transaction-pipeline failure (build / sign / serialize). |
| `BroadcastError` | `/v2/transactions` rejected. Extra fields: `txid?`, `reason?`. Thrown by `sendTransaction`. |
| `SerializationError` | Wire encode/decode failure. |
| `SigningError` | Signing-step failure (signature derivation, hash mismatch). |
| `ContractCallError` | Failure during a contract call action (non-network). |
| `ReadOnlyCallError` | `/v2/contracts/call-read` returned `okay: false` (also surfaced as a plain error by `readContract`). |
| `WebSocketError` | WS connect / subscribe / RPC error or disconnect. Thrown by `watch*` if transport is HTTP. |
| `SimulationError` | `simulateCall` failure. Extra field: `writesDetected: boolean` — `true` when the contract function mutates state and cannot be simulated read-only. |

```ts
import { BroadcastError } from "@secondlayer/stacks";

try {
  await wallet.transferStx({ to, amount });
} catch (err) {
  if (err instanceof BroadcastError) {
    console.error(err.shortMessage, err.reason);
  }
  throw err;
}
```

Note: `getContract` read methods throw `ContractResponseError` (exported from `@secondlayer/stacks/actions`) on `(err …)` responses with `errorValue` populated.

## 17. AI tools — `@secondlayer/stacks/tools`

Vercel AI SDK (`ai@^6`) compatible read tools. Two usage modes.

**Bare exports** — use the default public client, which reads `STACKS_RPC_URL` and `STACKS_CHAIN` env vars:

```ts
import { generateText } from "ai";
import { getStxBalance, bnsReverse, getBlockHeight } from "@secondlayer/stacks/tools";

await generateText({
  model,
  tools: { getStxBalance, bnsReverse, getBlockHeight },
  prompt: "What's the balance of SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7?",
});
```

**Factory** — bind to an explicit client (testnet, custom RPC):

```ts
import { createPublicClient, http, testnet } from "@secondlayer/stacks";
import { createStacksTools } from "@secondlayer/stacks/tools";

const stacks = createStacksTools(
  createPublicClient({ chain: testnet, transport: http() }),
);

await generateText({ model, tools: stacks, prompt: "..." });
```

Available tools (factory + bare): `getStxBalance`, `getAccountInfo`, `getBlock`, `getBlockHeight`, `readContract`, `estimateFee`, `bnsResolve`, `bnsReverse`, `getTransaction`, `getAccountHistory`, `getMempoolStats`, `getNftHoldings`.

A Bitcoin-flavored set lives at `@secondlayer/stacks/tools/btc`.

## 18. Connect (browser wallet)

`@secondlayer/stacks/connect` wraps the `window.StacksProvider` (Leather, Xverse, Hiro Wallet) using the SIP-030 RPC API.

```ts
import {
  connect, disconnect, isConnected,
  getProvider, setProvider, isWalletInstalled,
  request,
} from "@secondlayer/stacks/connect";

if (isWalletInstalled()) {
  const result = await connect();            // → AddressesResult
  // result.addresses contains stx/btc entries
}

isConnected();                                // boolean (from local storage)
disconnect();
```

`getProvider()` discovery order: any provider set via `setProvider`, then `window.StacksProvider`, `window.LeatherProvider`, `window.XverseProvider`, `window.HiroWalletProvider`. Throws `ConnectError("No Stacks wallet found")` if none.

`request(method, params?)` is a thin wrapper over `provider.request(...)` — call any SIP-030 method (`stx_transferStx`, `stx_callContract`, `stx_signMessage`, etc.).

Pair with `providerToAccount` to drive `createWalletClient` from the connected wallet:

```ts
import { createWalletClient, http, mainnet } from "@secondlayer/stacks";
import { providerToAccount, getProvider } from "@secondlayer/stacks/connect";

const account = await providerToAccount(getProvider());
const wallet = createWalletClient({ chain: mainnet, transport: http(), account });

// Wallet actions on a ProviderAccount delegate to the wallet UI for signing.
await wallet.transferStx({ to: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7", amount: 1_000_000n });
```

### WalletConnect v2

`@secondlayer/stacks/connect/walletconnect`:

```ts
import { WalletConnectProvider, showModal, hideModal, qrSvg } from "@secondlayer/stacks/connect/walletconnect";
import { setProvider } from "@secondlayer/stacks/connect";

const wc = new WalletConnectProvider({
  projectId: "<wc-project-id>",
  metadata: { name: "My App", description: "…", url: "https://app.example.com", icons: [] },
});

await wc.pair();              // returns { uri } — render QR with qrSvg(uri) or showModal(uri)
await wc.waitForSession();    // resolves once user approves on wallet
setProvider(wc);              // now connect/getProvider use WalletConnect
```

Exports: `WalletConnectProvider`, `WcSession`, `WcRelay`, `qrSvg`, `showModal`, `hideModal`, types `WcProviderConfig`, `WcMetadata`, `WcPairResult`, `WcSessionSettled`, `WcSessionData`.

## 19. Extensions

Domain logic ships as composable extensions, documented separately in **`stacks-extensions.md`**:

- `@secondlayer/stacks/bns` — BNS reads + writes (`resolveName`, `getPrimaryName`, name claims).
- `@secondlayer/stacks/pox` — PoX-4 stacking (`stack-stx`, `delegate-stx`, pool ops).
- `@secondlayer/stacks/sbtc` — sBTC deposits, withdrawals, registry reads.
- `@secondlayer/stacks/stackingdao` — StackingDAO stSTX flows.

Composition pattern:

```ts
import { createPublicClient, http, mainnet } from "@secondlayer/stacks";
import { bns } from "@secondlayer/stacks/bns";
import { pox } from "@secondlayer/stacks/pox";

const client = createPublicClient({ chain: mainnet, transport: http() })
  .extend(bns())
  .extend(pox());

const owner = await client.bns.resolveName("satoshi.btc");
const cycle = await client.pox.getCurrentCycle();
```
