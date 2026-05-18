// Track print events from a specific contract and decode tuple fields.
//
// Print events are emitted via `(print { topic: "swap", ... })` in Clarity.
// Tuple keys become camelCase on `event.data`.
//
// Deploy:   sl subgraphs deploy examples/contract-events.ts
// Query:    sl subgraphs query amm-events swaps --filter "pool=SP123.pool-a" --sort _block_height --order desc

import { defineSubgraph } from "@secondlayer/subgraphs";

const POOL = "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault";

export default defineSubgraph({
  name: "amm-events",
  version: "1.0.0",
  description: "Decoded swap + liquidity events for one AMM pool",

  sources: {
    swap: { type: "print_event", contractId: POOL, topic: "swap" },
    addLiq: { type: "print_event", contractId: POOL, topic: "add-liquidity" },
    largeStx: { type: "stx_transfer", minAmount: 1_000_000_000n }, // 1000 STX
  },

  schema: {
    swaps: {
      columns: {
        pool: { type: "principal", indexed: true },
        trader: { type: "principal", indexed: true },
        tokenIn: { type: "text" },
        tokenOut: { type: "text" },
        amountIn: { type: "uint" },
        amountOut: { type: "uint" },
      },
    },
    liquidity_adds: {
      columns: {
        pool: { type: "principal", indexed: true },
        provider: { type: "principal", indexed: true },
        amountA: { type: "uint" },
        amountB: { type: "uint" },
      },
    },
    whale_stx_transfers: {
      columns: {
        sender: { type: "principal", indexed: true },
        recipient: { type: "principal", indexed: true },
        amount: { type: "uint" },
      },
    },
  },

  handlers: {
    swap(event, ctx) {
      // Tuple fields land on `event.data` with camelCase keys.
      const d = event.data as Record<string, unknown>;
      ctx.insert("swaps", {
        pool: event.contractId,
        trader: ctx.tx.sender,
        tokenIn: String(d.tokenIn ?? d.token_in ?? ""),
        tokenOut: String(d.tokenOut ?? d.token_out ?? ""),
        amountIn: d.amountIn ?? d.amount_in,
        amountOut: d.amountOut ?? d.amount_out,
      });
    },

    addLiq(event, ctx) {
      const d = event.data as Record<string, unknown>;
      ctx.insert("liquidity_adds", {
        pool: event.contractId,
        provider: ctx.tx.sender,
        amountA: d.amountA ?? d.amount_a,
        amountB: d.amountB ?? d.amount_b,
      });
    },

    largeStx(event, ctx) {
      ctx.insert("whale_stx_transfers", {
        sender: event.sender,
        recipient: event.recipient,
        amount: event.amount,
      });
    },
  },
});
