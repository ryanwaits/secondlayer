# Subgraphs

Subgraphs are TypeScript indexers. They declare source filters, a table schema,
and handlers that write rows.

## Contract

```typescript
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "token-transfers",
  version: "1.0.0",
  description: "Track token transfers",
  startBlock: 150000,
  sources: {
    transfer: {
      type: "ft_transfer",
      assetIdentifier: "SP123.token::token",
    },
  },
  schema: {
    transfers: {
      columns: {
        sender: { type: "principal", indexed: true },
        recipient: { type: "principal", indexed: true },
        amount: { type: "uint" },
      },
      indexes: [["sender", "recipient"]],
      uniqueKeys: [["_tx_id"]],
    },
  },
  handlers: {
    transfer: (event, ctx) => {
      ctx.insert("transfers", {
        sender: event.sender,
        recipient: event.recipient,
        amount: event.amount,
      });
    },
  },
});
```

## Sources

`sources` is a named object: `Record<string, SubgraphFilter>`.

The source key is the handler key. Do not use array sources or
`"contract::event"` handler names.

```typescript
sources: {
  swap: { type: "print_event", contractId: "SP123.amm-pool", topic: "swap" },
  addLiquidity: {
    type: "contract_call",
    contractId: "SP123.amm-pool",
    functionName: "add-liquidity",
  },
  largeStx: { type: "stx_transfer", minAmount: 100000000n },
},
handlers: {
  swap: (event, ctx) => {},
  addLiquidity: (event, ctx) => {},
  largeStx: (event, ctx) => {},
  "*": (event, ctx) => {},
}
```

## Event Payloads

Payloads are decoded and unwrapped. Amounts are `bigint`. Print event tuple keys
are camelized.

Print event:

```typescript
{
  topic: "swap",
  data: {
    tokenX: "SP123.token-a",
    tokenY: "SP123.token-b",
    dx: 1000000n,
    dy: 500000n,
  },
}
```

Contract call:

```typescript
{
  args: {
    recipient: "SP...",
    amount: 1000n,
  },
  result: { ok: true },
}
```

STX/FT/NFT transfer-style events expose fields such as `sender`, `recipient`,
`amount`, and `assetIdentifier` at the top level.

## Context API

```typescript
handlers: {
  transfer: async (event, ctx) => {
    ctx.insert("transfers", { sender: event.sender, amount: event.amount });
    ctx.patch("balances", { address: event.sender }, { updated: true });
    ctx.upsert("seen_txs", { tx_id: ctx.tx.txId }, { tx_id: ctx.tx.txId });
    ctx.delete("pending", { tx_id: ctx.tx.txId });

    await ctx.patchOrInsert("balances", { address: event.recipient }, {
      address: event.recipient,
      amount: (existing) =>
        (existing ? BigInt(existing.amount as string) : 0n) + event.amount,
    });

    const row = await ctx.findOne("balances", { address: event.sender });
    const rows = await ctx.findMany("transfers", { sender: event.sender });
    const count = await ctx.count("transfers");
    const total = await ctx.sum("transfers", "amount");
    const max = await ctx.max("transfers", "amount");
    const min = await ctx.min("transfers", "amount");
    const uniqueSenders = await ctx.countDistinct("transfers", "sender");

    ctx.block.height;
    ctx.block.hash;
    ctx.block.timestamp;
    ctx.block.burnBlockHeight;
    ctx.tx.txId;
    ctx.tx.sender;
    ctx.tx.type;
    ctx.tx.status;
    ctx.tx.contractId;
    ctx.tx.functionName;
  },
}
```

`ctx.upsert()` requires a matching `uniqueKeys` entry on the table.

System columns are added automatically: `_id`, `_block_height`, `_tx_id`,
`_created_at`.

## Commands

```bash
sl subgraphs scaffold SP123.contract-name --output subgraphs/my-subgraph.ts
sl subgraphs deploy subgraphs/my-subgraph.ts
sl subgraphs deploy subgraphs/my-subgraph.ts --reindex
sl subgraphs dev subgraphs/my-subgraph.ts
sl subgraphs list --json
sl subgraphs status my-subgraph
sl subgraphs query my-subgraph transfers --limit 10 --sort _block_height --order desc
sl subgraphs query my-subgraph transfers --filter sender=SP... --count
sl subgraphs generate my-subgraph -o src/secondlayer/my-subgraph.ts
sl subgraphs reindex my-subgraph
sl subgraphs delete my-subgraph
```
