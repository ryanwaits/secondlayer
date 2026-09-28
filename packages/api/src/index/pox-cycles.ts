/**
 * `/v1/index/pox/cycles` — reward cycles of the CURRENT PoX (PoX-5). Reads
 * the materialized `pox5_cycles` / `pox5_cycle_signers` rollup
 * (`packages/indexer/src/decode/pox5-cycles.ts`), served on hosted and
 * self-host alike (never gated by a decoder-enabled flag).
 *
 * PoX-4 history is retired outright (plan 078): the old rollup queried
 * `pox4_calls`, a table that stopped growing forever at the epoch 4.0 fork.
 * At the next PoX fork, repeat this move — a new `pox<N>_cycles` rollup, a
 * `pox_version` flip, this file rewritten again. The endpoint path never
 * changes.
 */

import { getSourceDb, parseJsonb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import { burnHeightToRewardCycle } from "@secondlayer/stacks/pox5";
import type { Kysely } from "kysely";
import type { IndexTip } from "./tip.ts";

export const POX_CYCLES_FILTERS = ["limit", "cursor"] as const;
export const POX_CYCLE_FILTERS = [] as const;

export const POX_VERSION = 5 as const;

// Mainnet PoX cycle math constants — mirrors the indexer's own copy
// (`pox5-cycles-storage.ts`). Kept as a local copy rather than an
// indexer import: the read API doesn't otherwise depend on indexer
// internals, and pox-5 is mainnet-only for now (same scope as pox-4).
const MAINNET_FIRST_BURNCHAIN_BLOCK_HEIGHT = 666_050;
const MAINNET_REWARD_CYCLE_LENGTH = 2_100;
const POX5_CYCLE_PARAMS = {
	firstBurnchainBlockHeight: MAINNET_FIRST_BURNCHAIN_BLOCK_HEIGHT,
	rewardCycleLength: MAINNET_REWARD_CYCLE_LENGTH,
};

/** `get-first-pox-5-reward-cycle` on mainnet — cycles before this are PoX-4,
 *  final, and not served here. */
export const FIRST_POX5_REWARD_CYCLE = 141;

export const POX4_NOT_SERVED_NOTE =
	"PoX-4 cycles are final and not served. Rebuild them from /v1/index/stacking on a self-hosted instance.";

/** A pox-5 reward cycle's materialized totals, before the tip-relative
 *  `is_current` / `is_frozen` flags are applied. */
export type Pox5CycleData = {
	reward_cycle: number;
	start_burn_height: number;
	prepare_start_burn_height: number;
	end_burn_height: number;
	total_stacked_ustx: string;
	reward_eligible_ustx: string;
	stakers: number;
	signers_in_set: number;
	/** bond index (as string) -> sats staked for this cycle. */
	bond_sats: Record<string, string>;
	bond_total_sats: string;
	sbtc_custodied_sats: string;
	rewards_allocated_stx: string;
	rewards_allocated_bond: string;
	reserve_deposit: string;
	rewards_per_token_stx: string | null;
	/** bond index (as string) -> cumulative rewards-per-sat for this cycle. */
	rewards_per_token_bond: Record<string, string>;
	distributions: number;
	rewards_claimed: string;
	computed_through_height: number;
};

export type Pox5Cycle = Pox5CycleData & {
	/** The tip's reward cycle. */
	is_current: boolean;
	/**
	 * Totals can no longer change — the tip's burn height has reached this
	 * cycle's `prepare_start_burn_height`. Closed and current cycles are
	 * frozen; a not-yet-started future cycle is open.
	 */
	is_frozen: boolean;
};

export type Pox5CycleSigner = {
	signer: string;
	delegated_ustx: string;
	stx_only_ustx: string;
	reward_shares_ustx: string;
	in_set: boolean;
	rewards_claimed: string;
};

export type PoxCyclesResponse = {
	pox_version: typeof POX_VERSION;
	cycles: Pox5Cycle[];
	next_cursor: number | null;
	tip: IndexTip;
};

export type PoxCycleResponse = {
	pox_version: typeof POX_VERSION;
	cycle: Pox5Cycle & { signers: Pox5CycleSigner[] };
	tip: IndexTip;
};

type CycleDbRow = {
	reward_cycle: number;
	start_burn_height: string | number;
	prepare_start_burn_height: string | number;
	end_burn_height: string | number;
	total_stacked_ustx: string;
	reward_eligible_ustx: string;
	stakers: number;
	signers_in_set: number;
	bond_sats: unknown;
	bond_total_sats: string;
	sbtc_custodied_sats: string;
	rewards_allocated_stx: string;
	rewards_allocated_bond: string;
	reserve_deposit: string;
	rewards_per_token_stx: string | null;
	rewards_per_token_bond: unknown;
	distributions: number;
	rewards_claimed: string;
	computed_through_height: string | number;
};

type SignerDbRow = {
	signer: string;
	delegated_ustx: string;
	stx_only_ustx: string;
	reward_shares_ustx: string;
	in_set: boolean;
	rewards_claimed: string;
};

function mapCycleRow(row: CycleDbRow): Pox5CycleData {
	return {
		reward_cycle: Number(row.reward_cycle),
		start_burn_height: Number(row.start_burn_height),
		prepare_start_burn_height: Number(row.prepare_start_burn_height),
		end_burn_height: Number(row.end_burn_height),
		total_stacked_ustx: row.total_stacked_ustx,
		reward_eligible_ustx: row.reward_eligible_ustx,
		stakers: Number(row.stakers),
		signers_in_set: Number(row.signers_in_set),
		bond_sats: parseJsonb<Record<string, string>>(row.bond_sats),
		bond_total_sats: row.bond_total_sats,
		sbtc_custodied_sats: row.sbtc_custodied_sats,
		rewards_allocated_stx: row.rewards_allocated_stx,
		rewards_allocated_bond: row.rewards_allocated_bond,
		reserve_deposit: row.reserve_deposit,
		rewards_per_token_stx: row.rewards_per_token_stx,
		rewards_per_token_bond: parseJsonb<Record<string, string>>(
			row.rewards_per_token_bond,
		),
		distributions: Number(row.distributions),
		rewards_claimed: row.rewards_claimed,
		computed_through_height: Number(row.computed_through_height),
	};
}

function mapSignerRow(row: SignerDbRow): Pox5CycleSigner {
	return {
		signer: row.signer,
		delegated_ustx: row.delegated_ustx,
		stx_only_ustx: row.stx_only_ustx,
		reward_shares_ustx: row.reward_shares_ustx,
		in_set: row.in_set,
		rewards_claimed: row.rewards_claimed,
	};
}

/** The reward cycle a burn height falls in, or `null` before pox-5's genesis
 *  burn height (an empty/dev instance's zero tip) — nothing is "current". */
function safeCurrentCycle(tipBurnHeight: number): number | null {
	if (tipBurnHeight < POX5_CYCLE_PARAMS.firstBurnchainBlockHeight) return null;
	return burnHeightToRewardCycle(tipBurnHeight, POX5_CYCLE_PARAMS);
}

function withFlags(
	data: Pox5CycleData,
	tipBurnHeight: number,
	currentCycle: number | null,
): Pox5Cycle {
	return {
		...data,
		is_current: currentCycle !== null && data.reward_cycle === currentCycle,
		is_frozen: tipBurnHeight >= data.prepare_start_burn_height,
	};
}

/** Resolves the tip's burn height from its Stacks height — injectable so
 *  callers can test `is_current` / `is_frozen` at synthetic tips without a
 *  database. */
export type PoxTipBurnHeightReader = (tip: IndexTip) => Promise<number>;

export async function readTipBurnHeight(
	tip: IndexTip,
	db: Kysely<Database> = getSourceDb(),
): Promise<number> {
	const row = await db
		.selectFrom("blocks")
		.select("burn_block_height")
		.where("height", "=", tip.block_height)
		.where("canonical", "=", true)
		.executeTakeFirst();
	return row?.burn_block_height ?? 0;
}

function parseCycleLimit(raw: string | null): number {
	if (raw === null) return 20;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1 || n > 100) {
		throw new ValidationError("limit must be an integer between 1 and 100");
	}
	return n;
}

function parseCycleCursor(raw: string | null): number | undefined {
	if (raw === null) return undefined;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0) {
		throw new ValidationError(
			"cursor must be a non-negative integer reward_cycle",
		);
	}
	return n;
}

export type PoxCyclesQuery = {
	limit: number;
	/** Exclusive upper bound on `reward_cycle` — the caller's `cursor` if
	 *  given, else `currentCycle + 2` so the list starts at `currentCycle +
	 *  1`. `undefined` means unbounded (highest cycle first). */
	before?: number;
};

export type PoxCyclesReader = (
	params: PoxCyclesQuery,
	db?: Kysely<Database>,
) => Promise<{ cycles: Pox5CycleData[]; next_cursor: number | null }>;

export type PoxCycleReader = (
	rewardCycle: number,
	db?: Kysely<Database>,
) => Promise<{ cycle: Pox5CycleData; signers: Pox5CycleSigner[] } | null>;

export async function readPoxCycles(
	params: PoxCyclesQuery,
	db: Kysely<Database> = getSourceDb(),
): Promise<{ cycles: Pox5CycleData[]; next_cursor: number | null }> {
	const { limit, before } = params;

	const beforeClause =
		before !== undefined ? sql`AND reward_cycle < ${before}` : sql``;

	const { rows } = await sql<CycleDbRow>`
		SELECT
			reward_cycle, start_burn_height, prepare_start_burn_height, end_burn_height,
			total_stacked_ustx, reward_eligible_ustx, stakers, signers_in_set,
			bond_sats, bond_total_sats, sbtc_custodied_sats,
			rewards_allocated_stx, rewards_allocated_bond, reserve_deposit,
			rewards_per_token_stx, rewards_per_token_bond,
			distributions, rewards_claimed, computed_through_height
		FROM pox5_cycles
		WHERE true ${beforeClause}
		ORDER BY reward_cycle DESC
		LIMIT ${limit + 1}
	`.execute(db);

	const cycles = rows.slice(0, limit).map(mapCycleRow);
	const hasMore = rows.length > limit;
	const last = cycles.at(-1);
	return {
		cycles,
		next_cursor: hasMore && last ? last.reward_cycle : null,
	};
}

export async function readPoxCycle(
	rewardCycle: number,
	db: Kysely<Database> = getSourceDb(),
): Promise<{ cycle: Pox5CycleData; signers: Pox5CycleSigner[] } | null> {
	const { rows } = await sql<CycleDbRow>`
		SELECT
			reward_cycle, start_burn_height, prepare_start_burn_height, end_burn_height,
			total_stacked_ustx, reward_eligible_ustx, stakers, signers_in_set,
			bond_sats, bond_total_sats, sbtc_custodied_sats,
			rewards_allocated_stx, rewards_allocated_bond, reserve_deposit,
			rewards_per_token_stx, rewards_per_token_bond,
			distributions, rewards_claimed, computed_through_height
		FROM pox5_cycles
		WHERE reward_cycle = ${rewardCycle}
	`.execute(db);
	const row = rows[0];
	if (!row) return null;

	const { rows: signerRows } = await sql<SignerDbRow>`
		SELECT signer, delegated_ustx, stx_only_ustx, reward_shares_ustx, in_set, rewards_claimed
		FROM pox5_cycle_signers
		WHERE reward_cycle = ${rewardCycle}
		ORDER BY signer ASC
	`.execute(db);

	return {
		cycle: mapCycleRow(row),
		signers: signerRows.map(mapSignerRow),
	};
}

export async function getPoxCyclesResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	tipBurnHeight?: number;
	readPoxCycles?: PoxCyclesReader;
	readTipBurnHeight?: PoxTipBurnHeightReader;
}): Promise<PoxCyclesResponse> {
	// Validate first: a bad `limit`/`cursor` should 400 without ever touching
	// the tip.
	const limit = parseCycleLimit(opts.query.get("limit"));
	const cursor = parseCycleCursor(opts.query.get("cursor"));

	const tipBurnHeight =
		opts.tipBurnHeight ??
		(await (opts.readTipBurnHeight ?? readTipBurnHeight)(opts.tip));
	const currentCycle = safeCurrentCycle(tipBurnHeight);

	// No cursor: start the list at the next reward cycle (current + 1), not
	// the farthest future one a PoX-5 bond can reach. A cursor still reaches
	// any cycle beyond that. Unknown current cycle (pre pox-5 tip) falls back
	// to unbounded, highest cycle first.
	const before =
		cursor ?? (currentCycle !== null ? currentCycle + 2 : undefined);

	const reader = opts.readPoxCycles ?? readPoxCycles;
	const { cycles, next_cursor } = await reader({ limit, before });
	return {
		pox_version: POX_VERSION,
		cycles: cycles.map((c) => withFlags(c, tipBurnHeight, currentCycle)),
		next_cursor,
		tip: opts.tip,
	};
}

export type PoxCycleLookup =
	| { kind: "ok"; response: PoxCycleResponse }
	| { kind: "not_found" }
	| { kind: "pox4_not_served" };

export async function getPoxCycleResponse(opts: {
	rewardCycle: number;
	tip: IndexTip;
	tipBurnHeight?: number;
	readPoxCycle?: PoxCycleReader;
	readTipBurnHeight?: PoxTipBurnHeightReader;
}): Promise<PoxCycleLookup> {
	if (opts.rewardCycle < FIRST_POX5_REWARD_CYCLE) {
		return { kind: "pox4_not_served" };
	}
	const reader = opts.readPoxCycle ?? readPoxCycle;
	const result = await reader(opts.rewardCycle);
	if (!result) return { kind: "not_found" };

	const tipBurnHeight =
		opts.tipBurnHeight ??
		(await (opts.readTipBurnHeight ?? readTipBurnHeight)(opts.tip));
	const currentCycle = safeCurrentCycle(tipBurnHeight);
	return {
		kind: "ok",
		response: {
			pox_version: POX_VERSION,
			cycle: {
				...withFlags(result.cycle, tipBurnHeight, currentCycle),
				signers: result.signers,
			},
			tip: opts.tip,
		},
	};
}
