import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * sBTC balance ledger — one row per address, updated on every transfer,
 * mint, and burn. Correct ONLY when indexed from genesis (a balance is the
 * sum of all history), so deploy under the genesis-exempt account.
 *
 * Uses ctx.increment — SQL-atomic deltas that commute, so same-block
 * receive-then-forward cycles, replays, and concurrency are all safe
 * (fix-f040).
 *
 * Reads (no key):
 *   GET /v1/subgraphs/sbtc-balances/balances?address=SP...
 *   GET /v1/subgraphs/sbtc-balances/balances/aggregate?_sum=balance&_count=true
 */

const ASSET =
	"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";

export default defineSubgraph({
	name: "sbtc-balances",
	description:
		"Live sBTC balance per address — every transfer, mint, and burn applied in order from genesis.",
	startBlock: 1,
	sources: {
		transfer: { type: "ft_transfer", assetIdentifier: ASSET },
		mint: { type: "ft_mint", assetIdentifier: ASSET },
		burn: { type: "ft_burn", assetIdentifier: ASSET },
	},
	schema: {
		balances: {
			columns: {
				address: { type: "principal", indexed: true },
				balance: { type: "uint" },
			},
			uniqueKeys: [["address"]],
		},
	},
	handlers: {
		transfer: async (e, ctx) => {
			ctx.increment(
				"balances",
				{ address: e.sender },
				{ balance: -BigInt(e.amount) },
			);
			ctx.increment(
				"balances",
				{ address: e.recipient },
				{ balance: BigInt(e.amount) },
			);
		},
		mint: async (e, ctx) => {
			ctx.increment(
				"balances",
				{ address: e.recipient },
				{ balance: BigInt(e.amount) },
			);
		},
		burn: async (e, ctx) => {
			ctx.increment(
				"balances",
				{ address: e.sender },
				{ balance: -BigInt(e.amount) },
			);
		},
	},
});
