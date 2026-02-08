# StackingDAO

StackingDAO liquid staking extension. Deposit STX, receive stSTX, earn auto-compounding stacking rewards.

**Mainnet only** — no testnet deployment exists.

## Setup

```typescript
import { createPublicClient, createWalletClient, http, mainnet } from "@secondlayer/stacks";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import { stackingDao } from "@secondlayer/stacks/stackingdao";

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
}).extend(stackingDao());

const wallet = createWalletClient({
  account: privateKeyToAccount("0x..."),
  chain: mainnet,
  transport: http(),
}).extend(stackingDao());
```

## Deposit STX

```typescript
// Deposit 100 STX, receive stSTX
await wallet.stackingDao.deposit({ amount: 100_000_000n });

// With referrer
await wallet.stackingDao.deposit({
  amount: 100_000_000n,
  referrer: "SP2J6...",
});
```

## Withdraw

Three withdrawal paths:

### Standard Withdrawal (2-step)

```typescript
// Step 1: Burn stSTX, receive NFT receipt
await wallet.stackingDao.initWithdraw({ ststxAmount: 95_000_000n });

// Step 2: After unlock height, burn NFT, receive STX
await wallet.stackingDao.withdraw({ nftId: 42n });
```

### Instant Withdrawal (idle STX only)

```typescript
// Withdraw from idle reserve — instant, no NFT
await wallet.stackingDao.withdrawIdle({ ststxAmount: 1_000_000n });
```

## Read-Only Queries

```typescript
// stSTX balance
const balance = await client.stackingDao.getStSTXBalance("SP2J6...");

// Exchange rate info
const rate = await client.stackingDao.getExchangeRate();
console.log(rate.stxPerStstx);  // STX per 1 stSTX
console.log(rate.totalStx);     // total STX in protocol
console.log(rate.ststxSupply);  // total stSTX minted

// Total stSTX supply
const supply = await client.stackingDao.getTotalSupply();

// Withdrawal NFT info
const info = await client.stackingDao.getWithdrawalInfo(42n);
if (info) {
  console.log(info.ststxAmount);
  console.log(info.stxAmount);
  console.log(info.unlockBurnHeight);
}

// Fee rates
const fees = await client.stackingDao.getFees();
console.log(fees.stackFee);
console.log(fees.unstackFee);
console.log(fees.withdrawIdleFee);

// Reserve balance
const reserve = await client.stackingDao.getReserveBalance();

// Deposit shutdown status
const shutdown = await client.stackingDao.getShutdownDeposits();
```

## Architecture Note

StackingDAO's core contract functions require multiple trait arguments (reserve, commission, staking, direct-helpers). The extension fills these automatically — you only pass your data.
