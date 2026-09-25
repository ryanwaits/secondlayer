// SIP-010 token transfer indexer that ALSO maintains running balances per holder.
//
// Demonstrates:
//   - Filtering by asset identifier (`SP....token::token-name`)
//   - Append-only `transfers` table (one row per event)
//   - Upserted `balances` table (one row per holder, requires uniqueKeys)
//   - increment to update both sides of a transfer (deltas commute)
//
// Deploy:   secondlayer subgraphs deploy examples/sip010-balances.ts
// Query:    secondlayer subgraphs query usda-token balances --sort balance --order desc --limit 20

import { defineSubgraph } from "@secondlayer/subgraphs";

const TOKEN = "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.usda-token::usda";

export default defineSubgraph({
  name: "usda-token",
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
    transfer(event, ctx) {
      ctx.insert("transfers", {
        sender: event.sender,
        recipient: event.recipient,
        amount: event.amount,
      });
      ctx.increment("balances", { holder: event.sender }, { balance: -event.amount });
      ctx.increment("balances", { holder: event.recipient }, { balance: event.amount });
    },

    mint(event, ctx) {
      ctx.increment("balances", { holder: event.recipient }, { balance: event.amount });
    },

    burn(event, ctx) {
      ctx.increment("balances", { holder: event.sender }, { balance: -event.amount });
    },
  },
});
