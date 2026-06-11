import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * sBTC balance ledger — one row per address, updated on every transfer,
 * mint, and burn. Correct ONLY when indexed from genesis (a balance is the
 * sum of all history), so deploy under the genesis-exempt account.
 *
 * Reads (no key):
 *   GET /v1/subgraphs/sbtc-balances/balances?address=SP...
 *   GET /v1/subgraphs/sbtc-balances/balances/aggregate?_sum=balance&_count=true
 */

const ASSET = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";

type BalanceRow = { balance?: string | number | bigint };

const toBig = (v: string | number | bigint | undefined) => BigInt(v ?? 0);

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
			await ctx.patchOrInsert(
				"balances",
				{ address: e.sender },
				{
					address: e.sender,
					balance: (existing: BalanceRow | null) =>
						toBig(existing?.balance) - BigInt(e.amount),
				},
			);
			await ctx.patchOrInsert(
				"balances",
				{ address: e.recipient },
				{
					address: e.recipient,
					balance: (existing: BalanceRow | null) =>
						toBig(existing?.balance) + BigInt(e.amount),
				},
			);
		},
		mint: async (e, ctx) => {
			await ctx.patchOrInsert(
				"balances",
				{ address: e.recipient },
				{
					address: e.recipient,
					balance: (existing: BalanceRow | null) =>
						toBig(existing?.balance) + BigInt(e.amount),
				},
			);
		},
		burn: async (e, ctx) => {
			await ctx.patchOrInsert(
				"balances",
				{ address: e.sender },
				{
					address: e.sender,
					balance: (existing: BalanceRow | null) =>
						toBig(existing?.balance) - BigInt(e.amount),
				},
			);
		},
	},
});
