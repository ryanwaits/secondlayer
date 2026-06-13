import { defineSubgraph } from "@secondlayer/subgraphs";

// The same sales index as ./indexer.ts — but Secondlayer runs the loop.
// One file in: hosted Postgres tables, a public REST API, backfill, and
// reorg handling out. Deploy with `sl subgraphs deploy subgraph.ts`.
const MARKETPLACE = "SPNWZ5V2TPWGQGVDR6T7B6RQ4XMGZ4PXTEE0VQ0S.marketplace-v4";

export default defineSubgraph({
	name: "gamma-sales",
	description:
		"Every Gamma marketplace sale — buyer, collection, and token id, decoded from purchase-asset calls.",
	sources: {
		sale: {
			type: "contract_call",
			contractId: MARKETPLACE,
			functionName: "purchase-asset",
		},
	},
	schema: {
		sales: {
			columns: {
				tx_id: { type: "text" },
				buyer: { type: "principal", indexed: true },
				collection: { type: "principal", indexed: true },
				token_id: { type: "uint" },
			},
			uniqueKeys: [["tx_id"]],
		},
	},
	handlers: {
		sale: async (event, ctx) => {
			if (event.tx.status !== "success") return;
			const [collection, tokenId] = event.args;
			ctx.insert("sales", {
				tx_id: event.tx.txId,
				buyer: event.sender,
				collection: String(collection),
				token_id: BigInt(String(tokenId)),
			});
		},
	},
});
