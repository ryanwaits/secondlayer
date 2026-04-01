import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
	name: "contract-registry",
	version: "1.0.0",
	description: "Indexes all deployed contracts for fuzzy search by name",

	sources: [{ type: "smart_contract" }],

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
		smart_contract: async (event, ctx) => {
			const contractId = event.tx?.contractId ?? ctx.tx.sender;
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
