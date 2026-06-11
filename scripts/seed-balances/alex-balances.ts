import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * ALEX balance ledger — one row per address, updated on every transfer,
 * mint, and burn. Correct ONLY when indexed from genesis (a balance is the
 * sum of all history), so deploy under the genesis-exempt account.
 *
 * Reads (no key):
 *   GET /v1/subgraphs/alex-balances/balances?address=SP...
 *   GET /v1/subgraphs/alex-balances/balances/aggregate?_sum=balance&_count=true
 */

const ASSET = "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token::alex";

type BalanceRow = { balance?: string | number | bigint };

const toBig = (v: string | number | bigint | undefined) => BigInt(v ?? 0);

export default defineSubgraph({
	name: "alex-balances",
	description:
		"Live ALEX balance per address — every transfer, mint, and burn applied in order from genesis.",
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
