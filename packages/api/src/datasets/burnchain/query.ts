import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";

// Burnchain (Bitcoin) PoX reward datasets, keyed by burn block height. Two
// views over the data the indexer captures from /new_burn_block:
//   - rewards: actual BTC payouts (reward_recipients), cursor burn_height:reward_index
//   - reward-slots: reward-set membership (reward_slot_holders), cursor burn_height:slot_index
// Both go-forward only (prior burn blocks were never persisted).

// ── parsing helpers ────────────────────────────────────────────────

function parseNonNegativeInteger(value: string, name: string): number {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}
	return parsed;
}

function parseLimit(value: string | undefined): number {
	if (value === undefined) return 200;
	const parsed = parseNonNegativeInteger(value, "limit");
	if (parsed === 0)
		throw new ValidationError("limit must be a positive integer");
	return Math.min(1000, parsed);
}

function parseFilter(
	value: string | undefined,
	name: string,
): string | undefined {
	if (value === undefined) return undefined;
	if (value.length === 0)
		throw new ValidationError(`${name} must not be empty`);
	return value;
}

/** cursor = <burn_block_height>:<index> (reward_index or slot_index). */
function parseBurnCursor(value: string): {
	burn_block_height: number;
	index: number;
} {
	const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value);
	if (!match) {
		throw new ValidationError("cursor must use <burn_block_height>:<index>");
	}
	const burnBlockHeight = Number(match[1]);
	const index = Number(match[2]);
	if (!Number.isSafeInteger(burnBlockHeight) || !Number.isSafeInteger(index)) {
		throw new ValidationError("cursor must use <burn_block_height>:<index>");
	}
	return { burn_block_height: burnBlockHeight, index };
}

function bumpCursor(
	burnBlockHeight: number,
	index: number,
	indexColumn: "reward_index" | "slot_index",
): RawBuilder<unknown> {
	return sql`
		(
			burn_block_height > ${burnBlockHeight}
			OR (
				burn_block_height = ${burnBlockHeight}
				AND ${sql.ref(indexColumn)} > ${index}
			)
		)
	`;
}

type ParsedRange = {
	after?: { burn_block_height: number; index: number };
	fromBlock: number;
	toBlock: number;
	limit: number;
};

function parseRange(
	query: URLSearchParams,
	tip: { burn_block_height: number },
): ParsedRange {
	const cursorRaw = query.get("cursor") ?? undefined;
	const fromBlockRaw = query.get("from_block") ?? undefined;
	const toBlockRaw = query.get("to_block") ?? undefined;
	if (cursorRaw && fromBlockRaw !== undefined) {
		throw new ValidationError("cursor and from_block are mutually exclusive");
	}

	const after = cursorRaw ? parseBurnCursor(cursorRaw) : undefined;
	// Go-forward dataset is small (≤2 rows/burn block), so default to the full
	// indexed range and let the cursor paginate, rather than a time window.
	const fromBlock =
		fromBlockRaw !== undefined
			? parseNonNegativeInteger(fromBlockRaw, "from_block")
			: (after?.burn_block_height ?? 0);
	const toBlock =
		toBlockRaw !== undefined
			? Math.min(
					parseNonNegativeInteger(toBlockRaw, "to_block"),
					tip.burn_block_height,
				)
			: tip.burn_block_height;

	return {
		after,
		fromBlock,
		toBlock,
		limit: parseLimit(query.get("limit") ?? undefined),
	};
}

// ── /v1/datasets/burnchain/rewards ─────────────────────────────────

export type BurnchainRewardRow = {
	cursor: string;
	burn_block_height: number;
	burn_block_hash: string;
	reward_index: number;
	recipient_btc: string;
	amount_sats: string;
	burn_amount: string;
};

type BurnchainRewardDbRow = {
	cursor: string;
	burn_block_height: string | number;
	burn_block_hash: string;
	reward_index: string | number;
	recipient_btc: string;
	amount_sats: string;
	burn_amount: string;
};

export type ReadBurnchainRewardsParams = {
	after?: { burn_block_height: number; index: number };
	fromBlock: number;
	toBlock: number;
	limit: number;
	recipient?: string;
	db?: Kysely<Database>;
};

export type ReadBurnchainRewardsResult = {
	rewards: BurnchainRewardRow[];
	next_cursor: string | null;
};

export type BurnchainRewardsReader = (
	params: ReadBurnchainRewardsParams,
) => Promise<ReadBurnchainRewardsResult>;

export async function readBurnchainRewards(
	params: ReadBurnchainRewardsParams,
): Promise<ReadBurnchainRewardsResult> {
	if (params.toBlock < params.fromBlock)
		return { rewards: [], next_cursor: null };
	const db = params.db ?? getSourceDb();

	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`burn_block_height >= ${params.fromBlock}`,
		sql`burn_block_height <= ${params.toBlock}`,
	];
	if (params.recipient) {
		predicates.push(sql`recipient_btc = ${params.recipient}`);
	}
	if (params.after) {
		predicates.push(
			bumpCursor(
				params.after.burn_block_height,
				params.after.index,
				"reward_index",
			),
		);
	}

	const { rows } = await sql<BurnchainRewardDbRow>`
		SELECT cursor, burn_block_height, burn_block_hash, reward_index,
			recipient_btc, amount_sats, burn_amount
		FROM burn_block_rewards
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY burn_block_height ASC, reward_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const rewards = rows.slice(0, params.limit).map(
		(row): BurnchainRewardRow => ({
			cursor: row.cursor,
			burn_block_height: Number(row.burn_block_height),
			burn_block_hash: row.burn_block_hash,
			reward_index: Number(row.reward_index),
			recipient_btc: row.recipient_btc,
			amount_sats: row.amount_sats,
			burn_amount: row.burn_amount,
		}),
	);
	const last = rewards.at(-1);
	return {
		rewards,
		next_cursor: last ? `${last.burn_block_height}:${last.reward_index}` : null,
	};
}

export async function getBurnchainRewardsResponse(opts: {
	query: URLSearchParams;
	tip: { burn_block_height: number };
	readRewards?: BurnchainRewardsReader;
}): Promise<{
	rewards: BurnchainRewardRow[];
	next_cursor: string | null;
	tip: { burn_block_height: number };
}> {
	const range = parseRange(opts.query, opts.tip);
	const reader = opts.readRewards ?? readBurnchainRewards;
	const result = await reader({
		after: range.after,
		fromBlock: range.fromBlock,
		toBlock: range.toBlock,
		limit: range.limit,
		recipient: parseFilter(
			opts.query.get("recipient") ?? undefined,
			"recipient",
		),
	});
	return {
		rewards: result.rewards,
		next_cursor: result.next_cursor,
		tip: opts.tip,
	};
}

// ── /v1/datasets/burnchain/reward-slots ────────────────────────────

export type BurnchainRewardSlotRow = {
	cursor: string;
	burn_block_height: number;
	burn_block_hash: string;
	slot_index: number;
	holder_btc: string;
};

type BurnchainRewardSlotDbRow = {
	cursor: string;
	burn_block_height: string | number;
	burn_block_hash: string;
	slot_index: string | number;
	holder_btc: string;
};

export type ReadBurnchainRewardSlotsParams = {
	after?: { burn_block_height: number; index: number };
	fromBlock: number;
	toBlock: number;
	limit: number;
	holder?: string;
	db?: Kysely<Database>;
};

export type ReadBurnchainRewardSlotsResult = {
	slots: BurnchainRewardSlotRow[];
	next_cursor: string | null;
};

export type BurnchainRewardSlotsReader = (
	params: ReadBurnchainRewardSlotsParams,
) => Promise<ReadBurnchainRewardSlotsResult>;

export async function readBurnchainRewardSlots(
	params: ReadBurnchainRewardSlotsParams,
): Promise<ReadBurnchainRewardSlotsResult> {
	if (params.toBlock < params.fromBlock)
		return { slots: [], next_cursor: null };
	const db = params.db ?? getSourceDb();

	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`burn_block_height >= ${params.fromBlock}`,
		sql`burn_block_height <= ${params.toBlock}`,
	];
	if (params.holder) predicates.push(sql`holder_btc = ${params.holder}`);
	if (params.after) {
		predicates.push(
			bumpCursor(
				params.after.burn_block_height,
				params.after.index,
				"slot_index",
			),
		);
	}

	const { rows } = await sql<BurnchainRewardSlotDbRow>`
		SELECT cursor, burn_block_height, burn_block_hash, slot_index, holder_btc
		FROM burn_block_reward_slots
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY burn_block_height ASC, slot_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const slots = rows.slice(0, params.limit).map(
		(row): BurnchainRewardSlotRow => ({
			cursor: row.cursor,
			burn_block_height: Number(row.burn_block_height),
			burn_block_hash: row.burn_block_hash,
			slot_index: Number(row.slot_index),
			holder_btc: row.holder_btc,
		}),
	);
	const last = slots.at(-1);
	return {
		slots,
		next_cursor: last ? `${last.burn_block_height}:${last.slot_index}` : null,
	};
}

export async function getBurnchainRewardSlotsResponse(opts: {
	query: URLSearchParams;
	tip: { burn_block_height: number };
	readSlots?: BurnchainRewardSlotsReader;
}): Promise<{
	slots: BurnchainRewardSlotRow[];
	next_cursor: string | null;
	tip: { burn_block_height: number };
}> {
	const range = parseRange(opts.query, opts.tip);
	const reader = opts.readSlots ?? readBurnchainRewardSlots;
	const result = await reader({
		after: range.after,
		fromBlock: range.fromBlock,
		toBlock: range.toBlock,
		limit: range.limit,
		holder: parseFilter(opts.query.get("holder") ?? undefined, "holder"),
	});
	return {
		slots: result.slots,
		next_cursor: result.next_cursor,
		tip: opts.tip,
	};
}
