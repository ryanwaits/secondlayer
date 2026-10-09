import { defineSubgraph } from "../src/define.ts";

/**
 * Reference state-level subgraph: the reserves an AMM vault holds per token,
 * straight from its `reserve` map. Every input is a named state write, so
 * its rows can be recomputed from block headers by anyone:
 *
 *   sl subgraphs deploy pool-reserves
 *   sl verify subgraph pool-reserves --replay --from 1230000 --to 1231000
 */
export default defineSubgraph({
	name: "pool-reserves",
	startBlock: 1_230_000,
	sources: {
		reserve: {
			type: "map_set",
			contractId: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-vault-v2-01",
			map: "reserve",
		},
	},
	schema: {
		reserves: {
			columns: { token: { type: "principal" }, amount: { type: "uint" } },
			uniqueKeys: [["token"]],
		},
	},
	handlers: {
		reserve: (event, ctx) => {
			ctx.upsert(
				"reserves",
				{ token: event.key as string },
				{ amount: event.value as bigint },
			);
		},
	},
});
