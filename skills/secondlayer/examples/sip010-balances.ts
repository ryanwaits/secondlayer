// SIP-010 token transfer indexer that ALSO maintains running balances per holder.
//
// Demonstrates:
//   - Filtering by asset identifier (`SP....token::token-name`)
//   - Append-only `transfers` table (one row per event)
//   - Upserted `balances` table (one row per holder, requires uniqueKeys)
//   - patchOrInsert to atomically update both sides of a transfer
//
// Deploy:   sl subgraphs deploy examples/sip010-balances.ts
// Query:    sl subgraphs query usda-token balances --sort balance --order desc --limit 20

import { defineSubgraph } from "@secondlayer/subgraphs";

const TOKEN = "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.usda-token::usda";

export default defineSubgraph({
  name: "usda-token",
  version: "1.0.0",
  description: "USDA token transfers + per-holder balances",

  sources: {
    transfer: { type: "ft_transfer", assetIdentifier: TOKEN },
    mint: { type: "ft_mint", assetIdentifier: TOKEN },
    burn: { type: "ft_burn", assetIdentifier: TOKEN },
  },

  schema: {
    transfers: {
      columns: {
        sender: { type: "principal", indexed: true },
        recipient: { type: "principal", indexed: true },
        amount: { type: "uint" },
      },
    },
    balances: {
      columns: {
        holder: { type: "principal", indexed: true },
        balance: { type: "uint" },
      },
      // Required for upsert.
      uniqueKeys: [["holder"]],
    },
  },

  handlers: {
    async transfer(event, ctx) {
      ctx.insert("transfers", {
        sender: event.sender,
        recipient: event.recipient,
        amount: event.amount,
      });

      // Debit sender. Values can be functions of the existing row.
      await ctx.patchOrInsert(
        "balances",
        { holder: event.sender },
        {
          holder: event.sender,
          balance: (row: { balance?: bigint } | null) =>
            (row?.balance ?? 0n) - (event.amount as bigint),
        },
      );

      // Credit recipient.
      await ctx.patchOrInsert(
        "balances",
        { holder: event.recipient },
        {
          holder: event.recipient,
          balance: (row: { balance?: bigint } | null) =>
            (row?.balance ?? 0n) + (event.amount as bigint),
        },
      );
    },

    async mint(event, ctx) {
      await ctx.patchOrInsert(
        "balances",
        { holder: event.recipient },
        {
          holder: event.recipient,
          balance: (row: { balance?: bigint } | null) =>
            (row?.balance ?? 0n) + (event.amount as bigint),
        },
      );
    },

    async burn(event, ctx) {
      await ctx.patchOrInsert(
        "balances",
        { holder: event.sender },
        {
          holder: event.sender,
          balance: (row: { balance?: bigint } | null) =>
            (row?.balance ?? 0n) - (event.amount as bigint),
        },
      );
    },
  },
});
