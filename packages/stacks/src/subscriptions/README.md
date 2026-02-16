# Subscriptions

Real-time WebSocket subscriptions for blocks, mempool, transactions, and balances.

## Setup

Requires a `webSocket` transport.

```typescript
import { createPublicClient, webSocket, mainnet } from "@secondlayer/stacks";

const client = createPublicClient({
  chain: mainnet,
  transport: webSocket(),
});
```

## Watch Blocks

```typescript
const sub = await client.watchBlocks({
  onBlock: (block) => {
    console.log("New block:", block.height);
  },
});

// Unsubscribe
sub.unsubscribe();
```

## Watch Mempool

```typescript
const sub = await client.watchMempool({
  onTransaction: (tx) => {
    console.log("Pending tx:", tx.tx_id);
  },
});
```

## Watch Transaction

```typescript
const sub = await client.watchTransaction({
  txId: "0xabc...",
  onUpdate: (update) => {
    console.log("Status:", update.tx_status);
  },
});
```

## Watch Address Activity

```typescript
// All transactions for an address
const sub = await client.watchAddress({
  address: "SP2J6...",
  onTransaction: (tx) => {
    console.log("Activity:", tx.tx_id);
  },
});

// Balance changes only
const sub = await client.watchAddressBalance({
  address: "SP2J6...",
  onChange: (balance) => {
    console.log("New balance:", balance.stx.balance);
  },
});
```

## Watch NFT Events

```typescript
const sub = await client.watchNftEvent({
  assetIdentifier: "SP2J6....my-nft::my-nft",
  onEvent: (event) => {
    console.log("NFT event:", event);
  },
});
```
