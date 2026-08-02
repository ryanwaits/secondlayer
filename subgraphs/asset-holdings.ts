import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Unified per-holder balance tracking across FT (incl. sBTC) + STX in one schema.
 * Replaces `token-balances.ts` (FT-only) so discovery can rank audit targets by
 * real $-at-risk instead of a single token's raw amount. NFTs are intentionally
 * excluded — illiquid, floor ≠ realizable, not the asset-safety wedge.
 *
 * Rows are keyed (kind, asset_identifier, holder). Query rows whose `holder` is a
 * contract principal (contains ".") to find which contracts hold value, and how
 * much. `find_value_contracts` merges these per holder and ranks by USD.
 *
 * STX events have no asset identifier → `asset_identifier` is the literal "STX".
 *
 * CONTRACT-ONLY: handlers index a holder ONLY when it's a contract principal
 * (id contains "."). Discovery only ever queries contract holders, so indexing
 * EOA balances is wasted rows — and EOAs are the sole source of negative balances
 * (genesis/coinbase STX and pre-index FT supply arrive with NO tracked mint event,
 * so an untracked EOA's first send debits below zero). Contracts have no
 * genesis/coinbase allocation: every contract holding comes from tracked transfers
 * and nets correctly (≥ 0). Filtering to contracts shrinks the table, speeds the
 * backfill, and removes the confusing negative rows.
 *
 * `amount` stays SIGNED (`int`) as a safety net: a per-write `uint` CHECK
 * constraint crashes the whole block on any transient negative (observed pre-fix:
 * block 286, holdings_amount_check). Signed never crashes; final contract balances
 * are still non-negative.
 *
 * Deploy:  sl subgraphs deploy subgraphs/asset-holdings.ts
 * Query:   GET /api/subgraphs/asset-holdings/holdings?_sort=amount&_order=desc&_limit=50
 *          GET /api/subgraphs/asset-holdings/holdings?kind=ft&holder=SP1A27...v0-vault-sbtc
 *          (response: { data: [...holdingsRow], meta: { total, limit, offset } })
 */
export default defineSubgraph({
	name: "asset-holdings",
	version: "1.0.0",
	description:
		"Per-holder balances across FT (incl. sBTC) + STX (USD-rankable TVL source)",

	sources: {
		ftXfer: { type: "ft_transfer" },
		ftMint: { type: "ft_mint" },
		ftBurn: { type: "ft_burn" },
		stxXfer: { type: "stx_transfer" },
		stxMint: { type: "stx_mint" },
		stxBurn: { type: "stx_burn" },
	},

	schema: {
		holdings: {
			columns: {
				// "ft" | "stx" — discriminates the asset class.
				kind: { type: "text", indexed: true },
				// FT asset id ("SP....token::name"); literal "STX" for stx.
				asset_identifier: { type: "text", indexed: true, search: true },
				// Contract principals contain a "." — that's the audit-target filter.
				holder: { type: "principal", indexed: true, search: true },
				// FT/STX base units. SIGNED: untracked-genesis debits may go negative
				// (see header) — a uint CHECK constraint crashes the block otherwise.
				amount: { type: "int" },
			},
			uniqueKeys: [["kind", "asset_identifier", "holder"]],
		},
	},

	handlers: {
		// --- FT: amount-denominated ---
		ftXfer: (event, ctx) => {
			const a = BigInt(event.amount ?? 0);
			if (event.sender) ft(ctx, event.assetIdentifier, event.sender, -a);
			if (event.recipient) ft(ctx, event.assetIdentifier, event.recipient, a);
		},
		ftMint: (event, ctx) => {
			if (event.recipient)
				ft(
					ctx,
					event.assetIdentifier,
					event.recipient,
					BigInt(event.amount ?? 0),
				);
		},
		ftBurn: (event, ctx) => {
			if (event.sender)
				ft(
					ctx,
					event.assetIdentifier,
					event.sender,
					-BigInt(event.amount ?? 0),
				);
		},

		// --- STX: amount-denominated, no asset identifier ---
		stxXfer: (event, ctx) => {
			const a = BigInt(event.amount ?? 0);
			if (event.sender) stx(ctx, event.sender, -a);
			if (event.recipient) stx(ctx, event.recipient, a);
		},
		stxMint: (event, ctx) => {
			if (event.recipient) stx(ctx, event.recipient, BigInt(event.amount ?? 0));
		},
		stxBurn: (event, ctx) => {
			if (event.sender) stx(ctx, event.sender, -BigInt(event.amount ?? 0));
		},
	},
});

// Only contract principals hold value in code — and they're all discovery queries.
const isContract = (holder: string): boolean => holder.includes(".");

// ctx.increment is the blessed atomic accumulator: amount = COALESCE(amount,0)+delta,
// applied at commit time so concurrent events on the same key never lose updates.
function ft(
	// biome-ignore lint/suspicious/noExplicitAny: subgraph runtime ctx shape
	ctx: any,
	assetId: string | undefined,
	holder: string,
	delta: bigint,
): void {
	if (!assetId || !isContract(holder)) return;
	ctx.increment(
		"holdings",
		{ kind: "ft", asset_identifier: assetId, holder },
		{ amount: delta },
	);
}
// biome-ignore lint/suspicious/noExplicitAny: subgraph runtime ctx shape
function stx(ctx: any, holder: string, delta: bigint): void {
	if (!isContract(holder)) return;
	ctx.increment(
		"holdings",
		{ kind: "stx", asset_identifier: "STX", holder },
		{ amount: delta },
	);
}
