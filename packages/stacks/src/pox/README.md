# PoX Stacking

PoX (Proof of Transfer) extension for STX stacking — earn Bitcoin rewards by locking STX.

Supports solo stacking and pool delegation via the `pox-4` contract.

## Setup

```typescript
import { createPublicClient, createWalletClient, http, mainnet } from "@secondlayer/stacks";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import { pox } from "@secondlayer/stacks/pox";

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
}).extend(pox());

const wallet = createWalletClient({
  account: privateKeyToAccount("0x..."),
  chain: mainnet,
  transport: http(),
}).extend(pox());
```

## Query Stacking State

```typescript
// Network info (cycle, minimum threshold, lengths)
const info = await client.pox.getPoxInfo();
console.log(info.minAmountUstx); // minimum to solo stack
console.log(info.rewardCycleId); // current cycle

// Check if an amount meets the threshold
const eligible = await client.pox.canStack(100_000_000_000n);

// Stacker info (returns null if not stacking)
const stacker = await client.pox.getStackerInfo("SP2J6...");

// Delegation info (returns null if not delegating)
const delegation = await client.pox.getDelegationInfo("SP2J6...");
```

## Solo Stacking

Lock STX directly and earn BTC rewards to your Bitcoin address.

```typescript
await wallet.pox.stackStx({
  amount: 100_000_000_000n,       // 100k STX in microSTX
  btcAddress: "bc1q...",           // BTC reward address
  lockPeriod: 12,                  // 1-12 cycles
  signerSig: signature,            // signer signature (buff 65)
  signerKey: publicKey,            // signer public key (buff 33)
  maxAmount: 100_000_000_000n,
  authId: 1n,
});
```

### Extend Lock

```typescript
await wallet.pox.stackExtend({
  extendCount: 6,                  // additional cycles (1-12)
  btcAddress: "bc1q...",
  signerSig: signature,
  signerKey: publicKey,
  maxAmount: 100_000_000_000n,
  authId: 2n,
});
```

### Increase Locked Amount

```typescript
await wallet.pox.stackIncrease({
  increaseBy: 50_000_000_000n,     // additional microSTX
  signerSig: signature,
  signerKey: publicKey,
  maxAmount: 150_000_000_000n,
  authId: 3n,
});
```

## Pool Delegation

Delegate STX to a pool operator who stacks on your behalf.

```typescript
// Delegate to pool
await wallet.pox.delegateStx({
  amount: 100_000_000_000n,
  delegateTo: "SP2...",            // pool operator address
  untilBurnHeight: 900_000n,       // optional expiry
  poxAddr: "bc1q...",              // optional BTC address restriction
});

// Revoke delegation
await wallet.pox.revokeDelegateStx();
```

## Utilities

```typescript
import { parseBtcAddress, burnHeightToRewardCycle, rewardCycleToBurnHeight } from "@secondlayer/stacks/pox";

// Parse any BTC address format to PoX tuple
const poxAddr = parseBtcAddress("bc1q...");

// Convert between burn heights and reward cycles
const cycle = burnHeightToRewardCycle(info, 850_000n);
const height = rewardCycleToBurnHeight(info, 95n);
```
