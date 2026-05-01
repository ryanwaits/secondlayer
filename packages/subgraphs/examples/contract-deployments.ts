import { defineSubgraph } from "../src/define.ts";

/**
 * Reference subgraph: tracks all smart contract deployments on Stacks.
 *
 * Deploy via the subgraphs API or CLI:
 *   sl subgraphs deploy contract-deployments
 *
 * Query examples:
 *   GET /api/subgraphs/contract-deployments/contracts?_search=bns
 *   GET /api/subgraphs/contract-deployments/contracts?deployer=SP000000000000000000002Q6VF78
 */
export default defineSubgraph({
	name: "contract-deployments",
	version: "1.0.0",
	description: "Tracks all smart contract deployments on Stacks",

	sources: { deploy: { type: "contract_deploy" } },

	schema: {
		contracts: {
			columns: {
				contract_id: { type: "text", search: true, indexed: true },
				name: { type: "text", search: true },
				deployer: { type: "principal", indexed: true },
				deploy_block: { type: "uint" },
				deploy_tx_id: { type: "text" },
			},
			uniqueKeys: [["contract_id"]],
		},
	},

	handlers: {
		deploy: async (event, ctx) => {
			// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
			const tx = (event as any).tx;
			const contractId = tx?.contractId ?? ctx.tx.sender;
			const name = contractId.includes(".")
				? contractId.split(".")[1]
				: contractId;

			ctx.upsert(
				"contracts",
				{ contract_id: contractId },
				{
					contract_id: contractId,
					name,
					deployer: ctx.tx.sender,
					deploy_block: ctx.block.height,
					deploy_tx_id: ctx.tx.txId,
				},
			);
		},
	},
});
