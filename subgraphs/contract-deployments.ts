// ───────────────────────────────────────────────────────────────────
// Canonical source for the HOSTED PUBLIC `contract-deployments` subgraph.
//
// Tracks every smart contract deployment on Stacks — contract_id and name
// are both `search: true` so `_search` does fuzzy matching against either.
// Mirrors packages/subgraphs/examples/contract-deployments.ts (kept there
// as the tutorial copy; this file is the deployed source of truth).
// ───────────────────────────────────────────────────────────────────

import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Track all smart contract deployments — contract id, name, deployer.
 *
 * Query examples once deployed:
 *   GET /v1/subgraphs/contract-deployments/contracts?_search=bns
 *   GET /v1/subgraphs/contract-deployments/contracts?deployer=SP000000000000000000002Q6VF78
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
			// contract_deploy events expose `contractId` and `deployer` directly.
			const contractId = event.contractId || ctx.tx.sender;
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
					deploy_block: BigInt(ctx.block.height),
					deploy_tx_id: ctx.tx.txId,
				},
			);
		},
	},
});
