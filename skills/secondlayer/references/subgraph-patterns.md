# Subgraph Patterns

Examples use current named object `sources` and decoded event payloads.

## DEX Swaps

```typescript
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "alex-swaps",
  sources: {
    swap: {
      type: "print_event",
      contractId: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01",
      topic: "swap",
    },
  },
  schema: {
    swaps: {
      columns: {
        sender: { type: "principal", indexed: true },
        token_x: { type: "text", indexed: true },
        token_y: { type: "text", indexed: true },
        amount_x: { type: "uint" },
        amount_y: { type: "uint" },
      },
      indexes: [["sender", "token_x"]],
    },
  },
  handlers: {
    swap: (event, ctx) => {
      ctx.insert("swaps", {
        sender: ctx.tx.sender,
        token_x: event.data.tokenX,
        token_y: event.data.tokenY,
        amount_x: event.data.dx,
        amount_y: event.data.dy,
      });
    },
  },
});
```

## NFT Marketplace

```typescript
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "nft-marketplace",
  sources: {
    listed: {
      type: "print_event",
      contractId: "SP123.marketplace",
      topic: "list-item",
    },
    unlisted: {
      type: "print_event",
      contractId: "SP123.marketplace",
      topic: "unlist-item",
    },
    purchased: {
      type: "print_event",
      contractId: "SP123.marketplace",
      topic: "purchase",
    },
  },
  schema: {
    listings: {
      columns: {
        nft_id: { type: "uint", indexed: true },
        seller: { type: "principal", indexed: true },
        price: { type: "uint" },
        status: { type: "text", indexed: true },
      },
      uniqueKeys: [["nft_id"]],
    },
    sales: {
      columns: {
        nft_id: { type: "uint", indexed: true },
        seller: { type: "principal" },
        buyer: { type: "principal", indexed: true },
        price: { type: "uint" },
      },
    },
  },
  handlers: {
    listed: (event, ctx) => {
      ctx.upsert("listings", { nft_id: event.data.nftId }, {
        nft_id: event.data.nftId,
        seller: ctx.tx.sender,
        price: event.data.price,
        status: "active",
      });
    },
    unlisted: (event, ctx) => {
      ctx.patch("listings", { nft_id: event.data.nftId }, {
        status: "cancelled",
      });
    },
    purchased: (event, ctx) => {
      ctx.patch("listings", { nft_id: event.data.nftId }, { status: "sold" });
      ctx.insert("sales", {
        nft_id: event.data.nftId,
        seller: event.data.seller,
        buyer: ctx.tx.sender,
        price: event.data.price,
      });
    },
  },
});
```

## Token Transfers With Balances

```typescript
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "token-balances",
  sources: {
    transfer: {
      type: "ft_transfer",
      assetIdentifier: "SP123.token::token",
    },
  },
  schema: {
    transfers: {
      columns: {
        from_addr: { type: "principal", indexed: true },
        to_addr: { type: "principal", indexed: true },
        amount: { type: "uint" },
      },
    },
    balances: {
      columns: {
        address: { type: "principal", indexed: true },
        balance: { type: "int" },
      },
      uniqueKeys: [["address"]],
    },
  },
  handlers: {
    transfer: async (event, ctx) => {
      ctx.insert("transfers", {
        from_addr: event.sender,
        to_addr: event.recipient,
        amount: event.amount,
      });

      await ctx.patchOrInsert("balances", { address: event.sender }, {
        address: event.sender,
        balance: (existing) =>
          (existing ? BigInt(existing.balance as string) : 0n) - event.amount,
      });

      await ctx.patchOrInsert("balances", { address: event.recipient }, {
        address: event.recipient,
        balance: (existing) =>
          (existing ? BigInt(existing.balance as string) : 0n) + event.amount,
      });
    },
  },
});
```

## STX Whale Transfers

```typescript
import { defineSubgraph } from "@secondlayer/subgraphs";

const WHALE_THRESHOLD = 100_000_000_000n;

export default defineSubgraph({
  name: "stx-whales",
  sources: {
    transfer: { type: "stx_transfer", minAmount: WHALE_THRESHOLD },
  },
  schema: {
    whale_transfers: {
      columns: {
        sender: { type: "principal", indexed: true },
        recipient: { type: "principal", indexed: true },
        amount: { type: "uint" },
      },
    },
  },
  handlers: {
    transfer: (event, ctx) => {
      ctx.insert("whale_transfers", {
        sender: event.sender,
        recipient: event.recipient,
        amount: event.amount,
      });
    },
  },
});
```
