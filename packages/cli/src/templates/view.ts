/**
 * Generate a starter view definition file with inline comments.
 */
export function generateViewTemplate(name: string): string {
  return `import { defineView } from "@secondlayer/views";

export default defineView({
  name: "${name}",
  version: "1.0.0",
  description: "TODO: describe what this view tracks",

  // Sources define what blockchain data this view processes.
  // Each source filters transactions/events by contract, type, function, or event.
  // Examples:
  //   { contract: "SP000...::my-contract" }              — all txs to a contract
  //   { contract: "SP000...::my-contract", event: "transfer" } — specific event
  //   { type: "stx_transfer", minAmount: 1000000n }      — STX transfers >= 1 STX
  //   { contract: "*.pox-*" }                             — wildcard contract match
  sources: [
    { contract: "SP000000000000000000002Q6VF78.pox-4" },
  ],

  // Schema defines the tables this view creates.
  // Each table gets auto-columns: _id, _block_height, _tx_id, _created_at.
  // Column types: text, uint, int, principal, boolean, timestamp, jsonb
  schema: {
    data: {
      columns: {
        sender: { type: "principal", indexed: true },
        amount: { type: "uint" },
        memo: { type: "text", nullable: true },
      },
      // Optional composite indexes
      // indexes: [["sender", "amount"]],
    },
  },

  // Handlers process matched events and write to your tables via the context.
  // Keys match source patterns (use sourceKey format), or "*" as catch-all.
  // Context methods: ctx.insert(), ctx.update(), ctx.delete()
  handlers: {
    "*": async (event, ctx) => {
      await ctx.insert("data", {
        sender: event.sender ?? event.tx?.sender,
        amount: event.amount ?? 0,
        memo: event.memo ?? null,
      });
    },
  },
});
`;
}
