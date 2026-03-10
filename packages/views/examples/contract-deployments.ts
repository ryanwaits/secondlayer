import { defineView } from "../src/define.ts";

/**
 * Reference view: tracks all smart contract deployments on Stacks.
 *
 * Deploy via the views API or CLI:
 *   sl views deploy contract-deployments
 *
 * Query examples:
 *   GET /api/views/contract-deployments/contracts?_search=bns
 *   GET /api/views/contract-deployments/contracts?deployer=SP000000000000000000002Q6VF78
 */
export default defineView({
  name: "contract-deployments",
  version: "1.0.0",
  description: "Tracks all smart contract deployments on Stacks",

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
      const contractId = (event as any).contract_id ?? ctx.tx.sender;
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
