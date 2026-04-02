/**
 * Generate a starter subgraph definition file with inline comments.
 */
export function generateSubgraphTemplate(name: string): string {
	return `import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "${name}",
  version: "1.0.0",
  description: "TODO: describe what this subgraph tracks",

  // Sources define what blockchain data this subgraph processes.
  // Each source is named — the name becomes the handler key.
  //
  // Filter types:
  //   { type: "ft_transfer", assetIdentifier: "SP...token::token-name" }
  //   { type: "ft_mint", assetIdentifier: "SP...token::token-name" }
  //   { type: "contract_call", contractId: "SP...contract", functionName: "swap" }
  //   { type: "contract_deploy" }
  //   { type: "print_event", contractId: "SP...contract", topic: "my-event" }
  //   { type: "stx_transfer", minAmount: 1000000n }
  //   { type: "nft_transfer", assetIdentifier: "SP...nft::nft-name" }
  sources: {
    handler: { type: "contract_call", contractId: "SP000000000000000000002Q6VF78.pox-4" },
  },

  // Schema defines the tables this subgraph creates.
  // Each table gets auto-columns: _id, _block_height, _tx_id, _created_at.
  // Column types: text, uint, int, principal, boolean, timestamp, jsonb
  schema: {
    data: {
      columns: {
        sender: { type: "principal", indexed: true },
        amount: { type: "uint" },
        memo: { type: "text", nullable: true },
      },
    },
  },

  // Handlers process matched events. Keys must match source names.
  // Context: ctx.insert(), ctx.update(), ctx.upsert(), ctx.patch(),
  //          ctx.patchOrInsert(), ctx.findOne(), ctx.findMany()
  handlers: {
    handler: (event, ctx) => {
      ctx.insert("data", {
        sender: ctx.tx.sender,
        amount: event.amount ?? 0,
        memo: null,
      });
    },
  },
});
`;
}
