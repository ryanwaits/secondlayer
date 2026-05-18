# `@secondlayer/stacks` — Domain Extensions Reference

This file is the source-of-truth reference for the four domain-specific extensions shipped with `@secondlayer/stacks`:

- **BNS** (`@secondlayer/stacks/bns`) — `.btc` name registration, resolution, and zonefiles (BNS v2).
- **PoX** (`@secondlayer/stacks/pox`) — locking STX to earn BTC rewards (pox-4).
- **sBTC** (`@secondlayer/stacks/sbtc`) — SIP-010 view of the sBTC fungible token.
- **StackingDAO** (`@secondlayer/stacks/stackingdao`) — liquid staking (STX ↔ stSTX).

Every extension is composed onto a `Client` via `.extend()`. Read-only methods work with a **public client**. Methods that submit transactions require a **wallet client** (one created with `createWalletClient` and a configured `account`).

```ts
import { createPublicClient, createWalletClient, http, mainnet } from "@secondlayer/stacks";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";

const publicClient = createPublicClient({ chain: mainnet, transport: http() });
const account = privateKeyToAccount("0x...");
const walletClient = createWalletClient({ account, chain: mainnet, transport: http() });
```

All amounts in this reference follow Stacks conventions:

- STX amounts are in **microSTX** (1 STX = 1,000,000 µSTX).
- sBTC amounts are in **satoshis** (sBTC has 8 decimals, matching BTC).
- Burn heights are **Bitcoin block heights** as `bigint`.

---

## 1. BNS (`bns`)

### Import + composition

```ts
import { bns } from "@secondlayer/stacks/bns";

const client = createWalletClient({ account, chain: mainnet, transport: http() })
  .extend(bns());

// client.bns.* is now available
```

### Concept summary

BNS v2 is the on-chain `.btc` naming system on Stacks. Each name is an NFT under the `SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2` contract (`ST2QEZ...` on testnet). The extension resolves names to owners, registers new names (either via the two-step preorder/register flow or the snipeable fast-claim), transfers ownership, sets a primary name, and reads/writes zonefiles (DNS-like records, ≤8192 bytes) stored in a separate `zonefile-resolver` contract.

Names default to the `.btc` namespace — passing `"alice"` is equivalent to `"alice.btc"`.

### Method table

| Method | Signature | Description |
|---|---|---|
| `resolveName` | `(name: string) => Promise<string \| null>` | Owner Stacks address for a name (or `null` if unregistered). |
| `getPrimaryName` | `(address: string) => Promise<string \| null>` | Primary BNS name set by an address. |
| `canRegister` | `(name: string) => Promise<boolean>` | `true` if the name is available. |
| `getNamePrice` | `(name: string) => Promise<bigint>` | Registration price in microSTX. |
| `getNameId` | `(name: string) => Promise<bigint \| null>` | NFT token ID for the name. |
| `getZonefile` | `(name: string) => Promise<Uint8Array \| null>` | Raw zonefile bytes (or `null`). |
| `preorder` | `(params: PreorderParams) => Promise<{ txid; salt }>` | Step 1 of secure registration (commit-reveal). |
| `register` | `(params: RegisterParams) => Promise<string>` | Step 2 — reveal after ~10 min. |
| `claimFast` | `(params: ClaimFastParams) => Promise<string>` | Instant single-tx registration (snipeable). |
| `transfer` | `(params: TransferParams) => Promise<string>` | Transfer name NFT to a new owner. |
| `setPrimary` | `(params: SetPrimaryParams) => Promise<string>` | Mark a name as the caller's primary. |
| `updateZonefile` | `(params: UpdateZonefileParams) => Promise<string>` | Write or clear zonefile bytes. |
| `revokeZonefile` | `(name: string) => Promise<string>` | Clear the zonefile entirely. |

Reads need a public client. Every write (`preorder`, `register`, `claimFast`, `transfer`, `setPrimary`, `updateZonefile`, `revokeZonefile`) needs a wallet client.

### Param shapes

```ts
interface PreorderParams       { name: string; namespace?: string; salt?: Uint8Array; }
interface RegisterParams       { name: string; namespace?: string; salt: Uint8Array; } // salt REQUIRED
interface ClaimFastParams      { name: string; namespace?: string; recipient: string; }
interface TransferParams       { name: string; namespace?: string; recipient: string; }
interface SetPrimaryParams     { name: string; namespace?: string; }
interface UpdateZonefileParams { name: string; namespace?: string; zonefile: string | Uint8Array | null; }
```

### Detailed usage

#### Reads

```ts
// Owner lookup
const owner = await client.bns.resolveName("alice.btc");
// => "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"

// Reverse lookup (primary name)
const primary = await client.bns.getPrimaryName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
// => "alice.btc" or null

// Availability + price
const available = await client.bns.canRegister("newname.btc");           // true
const price     = await client.bns.getNamePrice("newname.btc");          // 200000n µSTX = 0.2 STX

// NFT id (needed for marketplace flows; transfer/setPrimary look it up internally)
const id = await client.bns.getNameId("alice.btc");                      // 42n or null
```

#### Secure registration (preorder → register)

Two transactions, separated by **at least one Bitcoin block (~10 min)**. The first commits to a `hash160(name + namespace + salt)`; the second reveals. Anyone watching the mempool sees only the hash, so they can't front-run by registering the same name.

```ts
// Step 1: preorder
const { txid: preorderTxid, salt } = await client.bns.preorder({
  name: "bob.btc",
});
// ⚠️ Persist `salt` somewhere durable. Losing it means losing the preorder.

// Wait ~10 minutes (1 Bitcoin block) for the preorder tx to confirm.

// Step 2: register (consumes the salt)
const registerTxid = await client.bns.register({
  name: "bob.btc",
  salt,
});
```

`preorder` internally:
1. Validates the FQN.
2. Calls `canRegister` and throws if the name is taken.
3. Calls `getNamePrice` to fetch the burn amount.
4. Generates a 20-byte random salt (unless one was provided).
5. Hashes `name || namespace || salt` with `hash160`.
6. Submits `name-preorder` with a post-condition limiting the caller's STX burn to ≤ `price`.

#### Fast claim (snipeable)

One transaction, no salt, no waiting. Anyone reading the mempool can race you to claim the same name in the same block — only use this for names nobody is watching.

```ts
const txid = await client.bns.claimFast({
  name: "carol.btc",
  recipient: account.address,
});
```

#### Transfer

```ts
const txid = await client.bns.transfer({
  name: "alice.btc",
  recipient: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
});
```

The extension looks up the NFT id and current owner, then submits `transfer` with a post-condition that the current owner sends exactly that NFT.

#### Set primary

```ts
await client.bns.setPrimary({ name: "alice.btc" });
```

#### Zonefiles

```ts
// Read
const zf = await client.bns.getZonefile("alice.btc");
if (zf) console.log(new TextDecoder().decode(zf));

// Write — accepts string OR Uint8Array, max 8192 bytes
await client.bns.updateZonefile({
  name: "alice.btc",
  zonefile: `$ORIGIN alice.btc.\n$TTL 3600\n_http._tcp URI 10 1 "https://alice.example"\n`,
});

// Clear
await client.bns.updateZonefile({ name: "alice.btc", zonefile: null });
// or:
await client.bns.revokeZonefile("alice.btc");
```

Zonefile reads and writes go through a separate contract (`zonefile-resolver`) at the same deployer address as `BNS-V2`.

---

## 2. PoX (`pox`)

### Import + composition

```ts
import { pox } from "@secondlayer/stacks/pox";

const client = createWalletClient({ account, chain: mainnet, transport: http() })
  .extend(pox());
```

### Concept summary

PoX (Proof of Transfer, contract `pox-4`) lets STX holders **lock** their STX for a number of **reward cycles** in exchange for **BTC** sent to a Bitcoin address they specify. There are two flows:

- **Solo stacking** (`stackStx`) — you lock your own STX directly. Requires you meet the network minimum (`minAmountUstx`, hundreds of thousands of STX) AND have a **signer signature** authorizing your stack.
- **Pool delegation** (`delegateStx`) — you authorize a pool operator to stack on your behalf. The pool aggregates many delegators to meet the minimum and handles signing. This is the common path for most users.

A cycle is ~2 weeks (`rewardCycleLength` Bitcoin blocks, currently 2100). Locks are denominated in cycles; you pick `lockPeriod ∈ [1, 12]`.

### Method table

| Method | Signature | Description |
|---|---|---|
| `getPoxInfo` | `() => Promise<PoxInfo>` | Current cycle, minimum, cycle lengths. |
| `getStackerInfo` | `(address: string) => Promise<StackerInfo \| null>` | Active stacking position for an address. |
| `getDelegationInfo` | `(address: string) => Promise<DelegationInfo \| null>` | Active delegation for an address. |
| `canStack` | `(amount: bigint) => Promise<boolean>` | True if `amount >= minAmountUstx`. |
| `stackStx` | `(params: StackStxParams) => Promise<string>` | Solo stack — requires signer sig + key. |
| `delegateStx` | `(params: DelegateStxParams) => Promise<string>` | Authorize a pool operator. |
| `revokeDelegateStx` | `() => Promise<string>` | Revoke an active delegation. |
| `stackExtend` | `(params: StackExtendParams) => Promise<string>` | Extend an active solo lock. |
| `stackIncrease` | `(params: StackIncreaseParams) => Promise<string>` | Add more STX to an active solo lock. |

Reads use a public client. All writes need a wallet client (the extension throws `"Wallet client required"` otherwise).

### Param shapes

```ts
interface PoxInfo {
  rewardCycleId: bigint;
  minAmountUstx: bigint;
  prepareCycleLength: bigint;
  rewardCycleLength: bigint;
  firstBurnchainBlockHeight: bigint;
  totalLiquidSupplyUstx: bigint;
}

interface StackStxParams {
  amount: bigint;            // microSTX, must be >= minAmountUstx
  btcAddress: string;        // any BTC format: P2PKH (1...), P2SH (3...), P2WPKH (bc1q...), P2WSH, P2TR (bc1p...)
  lockPeriod: number;        // 1..12 cycles
  signerSig: Uint8Array | null; // 65-byte signature; null to use on-chain authorization
  signerKey: Uint8Array;     // 33-byte compressed signer pubkey
  maxAmount: bigint;         // signer-attested upper bound on locked amount
  authId: bigint;            // signer-chosen nonce, must match signature
  startBurnHeight: bigint;   // burn block to begin stacking
}

interface DelegateStxParams {
  amount: bigint;
  delegateTo: string;            // pool's Stacks principal
  untilBurnHeight?: bigint | null; // optional delegation expiry
  poxAddr?: string | null;       // optional restriction on which BTC addr the pool may use
}

interface StackExtendParams {
  extendCount: number;       // 1..12 additional cycles
  btcAddress: string;
  signerSig: Uint8Array | null;
  signerKey: Uint8Array;
  maxAmount: bigint;
  authId: bigint;
}

interface StackIncreaseParams {
  increaseBy: bigint;        // additional microSTX
  signerSig: Uint8Array | null;
  signerKey: Uint8Array;
  maxAmount: bigint;
  authId: bigint;
}
```

### Detailed usage

#### Reads

```ts
const info = await client.pox.getPoxInfo();
// {
//   rewardCycleId: 95n,
//   minAmountUstx: 120000000000n,     // 120,000 STX
//   prepareCycleLength: 100n,
//   rewardCycleLength: 2100n,         // ~2 weeks
//   firstBurnchainBlockHeight: 666050n,
//   totalLiquidSupplyUstx: 1465000000000000n,
// }

const stacker = await client.pox.getStackerInfo("SP2J6...");
// StackerInfo { firstRewardCycle, lockPeriod, poxAddr, rewardSetIndexes, delegatedTo }
// or null if not stacking

const delegation = await client.pox.getDelegationInfo("SP2J6...");
// DelegationInfo { amountUstx, delegatedTo, untilBurnHt, poxAddr }
// or null if no active delegation

const meetsMin = await client.pox.canStack(150_000n * 1_000_000n); // true
```

#### Pool delegation (most users)

```ts
// Delegate 50,000 STX to a pool, no expiry, no BTC-address restriction
await client.pox.delegateStx({
  amount: 50_000n * 1_000_000n,                                      // 50_000_000_000n µSTX
  delegateTo: "SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP",
});

// Revoke later
await client.pox.revokeDelegateStx();
```

Delegation does **not** lock STX immediately. The pool operator subsequently calls `delegate-stack-stx` on your behalf to lock your funds.

#### Solo stacking (advanced)

`stackStx` requires four signer-supplied fields: `signerSig`, `signerKey`, `maxAmount`, `authId`. **This SDK does not produce these values** — they come from a signer the stacker is associated with (typically a stacking pool's signer, even for self-bonded stackers). Direct solo stackers without a signer relationship cannot call this method; they need to either join a delegated pool or coordinate with a signer to obtain a signed authorization.

```ts
await client.pox.stackStx({
  amount: 150_000n * 1_000_000n,        // 150,000 STX (must be >= minAmountUstx)
  btcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  lockPeriod: 12,                       // 12 cycles ≈ 6 months
  startBurnHeight: 870_000n,
  signerSig: signerSigBytes,            // 65 bytes from the signer
  signerKey: signerPubkey,              // 33 bytes
  maxAmount: 200_000n * 1_000_000n,     // signer caps your max lock
  authId: 1n,                           // matches what signer signed
});
```

The extension validates `lockPeriod ∈ [1,12]` and `amount >= minAmountUstx`, parses `btcAddress` into the `{version, hashbytes}` tuple expected by Clarity, and attaches a post-condition that the caller sends exactly `amount` µSTX.

`btcAddress` supports legacy (`1...`, `3...`), nested segwit (`3...`), native segwit (`bc1q...`), and taproot (`bc1p...`) — see `POX_ADDRESS_VERSION` for the byte mapping. Testnet (`tb1...`, `bcrt1...`, `m/n...`, `2...`) is also accepted.

#### Extend / increase

Both require the same signer-supplied fields as `stackStx`.

```ts
// Add 6 more cycles to current lock
await client.pox.stackExtend({
  extendCount: 6,
  btcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  signerSig, signerKey, maxAmount, authId,
});

// Lock another 20,000 STX on top
await client.pox.stackIncrease({
  increaseBy: 20_000n * 1_000_000n,
  signerSig, signerKey, maxAmount, authId,
});
```

`stackIncrease` attaches a post-condition that the caller sends exactly `increaseBy` µSTX.

### Helpers re-exported from the module

```ts
import {
  POX_CONTRACTS,
  POX_ADDRESS_VERSION,
  MIN_LOCK_PERIOD,         // 1
  MAX_LOCK_PERIOD,         // 12
  parseBtcAddress,         // BTC string → { version, hashbytes }
  validateLockPeriod,
  burnHeightToRewardCycle, // (burnHeight, firstBurnchainBlockHeight, rewardCycleLength) => cycle
  rewardCycleToBurnHeight, // (cycle, firstBurnchainBlockHeight, rewardCycleLength) => burnHeight
} from "@secondlayer/stacks/pox";
```

---

## 3. sBTC (`sbtc`)

### Import + composition

```ts
import { sbtc } from "@secondlayer/stacks/sbtc";

const client = createPublicClient({ chain: mainnet, transport: http() })
  .extend(sbtc());
```

### Concept summary

sBTC is BTC pegged 1:1 onto Stacks as a SIP-010 fungible token, with 8 decimals (matching satoshis). Mainnet contract: `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`.

> **Important:** This extension only exposes the **SIP-010 view** of `sbtc-token` (supply, balances, metadata). Bitcoin → sBTC deposits and sBTC → Bitcoin withdrawals are mediated by the sBTC bridge (`sbtc-deposit`, `sbtc-registry`, and off-chain signer set) — those flows are **out of scope** for this extension. To send or receive sBTC inside the Stacks chain, use the standard SIP-010 `transfer` via `getContract` or the wallet's transfer flow.

### Method table

| Method | Signature | Description |
|---|---|---|
| `getTotalSupply` | `() => Promise<bigint>` | Total sBTC supply, in satoshis. |
| `getBalance` | `(owner: string) => Promise<bigint>` | sBTC balance of a Stacks principal, in satoshis. |
| `getName` | `() => Promise<string>` | Token name (`"sBTC"` on mainnet). |
| `getSymbol` | `() => Promise<string>` | Token symbol. |
| `getDecimals` | `() => Promise<bigint>` | Decimal count (`8n`). |
| `getTokenUri` | `() => Promise<string \| null>` | SIP-016 metadata URI. |

All methods are read-only and work on a public client.

### Detailed usage

```ts
const supply   = await client.sbtc.getTotalSupply();
// e.g. 4_812_000_000n satoshis = 48.12 sBTC

const balance  = await client.sbtc.getBalance("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
// e.g. 12_500_000n satoshis = 0.125 sBTC

const name     = await client.sbtc.getName();      // "sBTC"
const symbol   = await client.sbtc.getSymbol();    // "sBTC"
const decimals = await client.sbtc.getDecimals();  // 8n
const uri      = await client.sbtc.getTokenUri();  // "https://..." or null
```

### Helpers re-exported from the module

```ts
import {
  SBTC_CONTRACTS,                  // { mainnet: { address, token, deposit, registry }, testnet: {...} }
  SBTC_ASSET_IDENTIFIER_MAINNET,   // "SM3VDX...sbtc-token::sbtc-token"
  SBTC_ASSET_IDENTIFIER_TESTNET,
  SBTC_DECIMALS,                   // 8
  SBTC_UNIT_NAME,                  // "satoshis"
  SBTC_EVENT_TOPICS,               // tuple of registry print-event topics
  SBTC_BTC_ADDRESS_VERSION,        // same byte map as PoX
  sbtcContractId,                  // (network, "token" | "deposit" | "registry") => string
  satsToSbtc, sbtcToSats,
  bitcoinTxidFromHex, bitcoinTxidToHex, validateBitcoinTxid,
  formatBtcAddress,
} from "@secondlayer/stacks/sbtc";
```

Event-shape types (`CompletedDepositEvent`, `WithdrawalCreateEvent`, etc.) are re-exported for decoding `sbtc-registry` print events emitted on-chain — useful when watching the registry contract via Secondlayer subscriptions/subgraphs.

---

## 4. StackingDAO (`stackingDao`)

### Import + composition

```ts
import { stackingDao } from "@secondlayer/stacks/stackingdao";

const client = createWalletClient({ account, chain: mainnet, transport: http() })
  .extend(stackingDao());
```

> **Mainnet only.** Every call asserts `client.chain.network === "mainnet"` and throws `"StackingDAO is only available on mainnet"` otherwise.

### Concept summary

StackingDAO is a liquid-staking protocol on Stacks. You deposit STX, immediately receive `stSTX` (a SIP-010 token), and the protocol stacks the pooled STX to earn BTC rewards which auto-compound into the `stSTX` exchange rate. Withdrawals are a 2-step flow: `initWithdraw` burns your `stSTX` and mints an NFT receipt; after the lock unlocks (`unlockBurnHeight`), `withdraw` redeems the NFT for STX. If StackingDAO has idle STX in reserve, `withdrawIdle` lets you exit immediately for a fee.

Core contracts (mainnet deployer `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG`):

- `stacking-dao-core-v6` — user-facing deposit/withdraw entry point.
- `ststx-token` — the SIP-010 stSTX token.
- `ststx-withdraw-nft-v2` — withdrawal receipt NFT.
- `reserve-v1`, `data-core-v1`, `data-core-v3` — reserve/data queries.

Trait contract arguments (`reserve`, `commission`, `direct-helpers`, `staking`) are wired automatically — users never pass them.

### Method table

| Method | Signature | Description |
|---|---|---|
| `getStSTXBalance` | `(address: string) => Promise<bigint>` | stSTX balance for an address. |
| `getExchangeRate` | `() => Promise<ExchangeRateInfo>` | `{ stxPerStstx, ststxSupply, totalStx }`. |
| `getTotalSupply` | `() => Promise<bigint>` | Total stSTX outstanding. |
| `getWithdrawalInfo` | `(nftId: bigint) => Promise<WithdrawalInfo>` | `{ ststxAmount, stxAmount, unlockBurnHeight }` for a receipt NFT. |
| `getFees` | `() => Promise<FeeInfo>` | `{ stackFee, unstackFee, withdrawIdleFee }`. |
| `getReserveBalance` | `() => Promise<bigint>` | Total STX held in reserve. |
| `getShutdownDeposits` | `() => Promise<boolean>` | True if new deposits are paused. |
| `deposit` | `(params: DepositParams) => Promise<string>` | STX → stSTX. |
| `initWithdraw` | `(params: InitWithdrawParams) => Promise<string>` | Burn stSTX, mint NFT receipt. |
| `withdraw` | `(params: WithdrawParams) => Promise<string>` | Redeem NFT for STX (after unlock). |
| `withdrawIdle` | `(params: WithdrawIdleParams) => Promise<string>` | Instant exit from idle reserve. |

Reads use a public client. `deposit`, `initWithdraw`, `withdraw`, and `withdrawIdle` need a wallet client.

### Param shapes

```ts
interface DepositParams        { amount: bigint; referrer?: string; pool?: string; }
interface InitWithdrawParams   { ststxAmount: bigint; }
interface WithdrawParams       { nftId: bigint; }
interface WithdrawIdleParams   { ststxAmount: bigint; }

interface ExchangeRateInfo     { stxPerStstx: bigint; ststxSupply: bigint; totalStx: bigint; }
interface WithdrawalInfo       { ststxAmount: bigint; stxAmount: bigint; unlockBurnHeight: bigint; }
interface FeeInfo              { stackFee: bigint; unstackFee: bigint; withdrawIdleFee: bigint; }
```

### Detailed usage

#### Reads

```ts
const balance = await client.stackingDao.getStSTXBalance(account.address);

const rate = await client.stackingDao.getExchangeRate();
// { stxPerStstx: 1_087_500n, ststxSupply: 18_400_000_000_000n, totalStx: 20_010_000_000_000n }
// stxPerStstx is scaled — 1 stSTX ≈ 1.0875 STX in this example.

const supply  = await client.stackingDao.getTotalSupply();
const reserve = await client.stackingDao.getReserveBalance();
const fees    = await client.stackingDao.getFees();
// { stackFee: 50n, unstackFee: 50n, withdrawIdleFee: 100n }  // basis-point-ish units; check contract

const paused  = await client.stackingDao.getShutdownDeposits(); // true => deposits blocked

const info = await client.stackingDao.getWithdrawalInfo(1234n);
// { ststxAmount: 1_000_000_000n, stxAmount: 1_087_500_000n, unlockBurnHeight: 875_000n }
```

#### Deposit

```ts
// Deposit 100 STX
await client.stackingDao.deposit({
  amount: 100n * 1_000_000n,
});

// Optional: attribute to a referrer and/or specify a sub-pool
await client.stackingDao.deposit({
  amount: 100n * 1_000_000n,
  referrer: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
  pool: "SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP",
});
```

A post-condition is attached so the caller sends exactly `amount` µSTX.

#### 2-step withdrawal

`initWithdraw` burns your stSTX immediately and issues an NFT receipt. The receipt carries an `unlockBurnHeight` — you must wait until at least that Bitcoin block before `withdraw` can redeem it for STX.

```ts
// Step 1: burn stSTX, mint receipt NFT (returns txid; find nftId in tx events / on-chain state)
const initTxid = await client.stackingDao.initWithdraw({
  ststxAmount: 50n * 1_000_000n,   // 50 stSTX
});

// ... later, after the tx confirms, locate your nftId and inspect:
const info = await client.stackingDao.getWithdrawalInfo(nftId);
// info.unlockBurnHeight tells you when withdraw() will succeed

// Step 2: redeem (only succeeds at/after info.unlockBurnHeight)
await client.stackingDao.withdraw({ nftId });
```

`initWithdraw` attaches a post-condition that the caller sends exactly `ststxAmount` ststx FT.

#### Instant withdrawal (idle reserve)

If the protocol's STX reserve has enough idle balance, you can skip the wait at the cost of `withdrawIdleFee`:

```ts
await client.stackingDao.withdrawIdle({
  ststxAmount: 10n * 1_000_000n,
});
```

Same post-condition as `initWithdraw` — sends exactly `ststxAmount` ststx FT.

---

## Cross-extension notes

- **Public vs wallet client.** Every read method works on either. Writes (anything that returns a txid) require `createWalletClient` with an `account`.
- **Post-conditions** are attached automatically by every write method that moves user assets. You do not need to construct your own; if you want to override, drop down to `getContract`.
- **Network resolution** is driven by `client.chain.network` (`"mainnet"` / `"testnet"`). BNS, PoX, and sBTC support both; StackingDAO is mainnet-only.
- **Composition.** You can chain extensions: `client.extend(bns()).extend(pox()).extend(sbtc())`. Each adds its own namespace (`client.bns`, `client.pox`, `client.sbtc`) without colliding.
