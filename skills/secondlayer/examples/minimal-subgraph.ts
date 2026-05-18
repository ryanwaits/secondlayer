// Minimal subgraph: index every STX transfer into a table.
//
// Deploy:   sl subgraphs deploy examples/minimal-subgraph.ts --start-block <recent>
// Status:   sl subgraphs status stx-transfers -w
// Query:    sl subgraphs query stx-transfers transfers --sort _block_height --order desc --limit 10

import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "stx-transfers",
  version: "1.0.0",
  description: "Every STX transfer with sender, recipient, amount",

  sources: {
    transfer: { type: "stx_transfer" },
  },

  schema: {
    transfers: {
      columns: {
        sender: { type: "principal", indexed: true },
        recipient: { type: "principal", indexed: true },
        amount: { type: "uint" },
        memo: { type: "text", nullable: true },
      },
    },
  },

  handlers: {
    transfer(event, ctx) {
      ctx.insert("transfers", {
        sender: event.sender,
        recipient: event.recipient,
        amount: event.amount,
        memo: event.memo,
      });
    },
  },
});
