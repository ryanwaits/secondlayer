import { isPox4DecoderEnabled } from "@secondlayer/shared";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely } from "kysely";
import type { IndexTip } from "./tip.ts";

export const POX_CYCLES_FILTERS = ["limit", "cursor"] as const;

export const POX_CYCLE_FILTERS = [] as const;

/** Per-function action count within a reward cycle. */
export type PoxFunctionCount = {
	function_name: string;
	count: number;
};

/** Aggregate stats for one PoX reward cycle. */
export type PoxCycle = {
	reward_cycle: number;
	/** Total ustx locked across all stack-* calls in this cycle (bigint-safe string). */
	total_stacked_ustx: string;
	unique_stackers: number;
	unique_delegators: number;
	action_count: number;
	start_block_height: number;
	end_block_height: number;
	/** True when this is the latest reward cycle (still accumulating new actions). */
	is_current: boolean;
	function_breakdown: PoxFunctionCount[];
};

export type PoxCyclesResponse = {
	cycles: PoxCycle[];
	next_cursor: number | null;
	tip: IndexTip;
	notes?: string;
};

export type PoxCycleResponse = {
	cycle: PoxCycle;
	tip: IndexTip;
	notes?: string;
};

const POX4_DISABLED_NOTE =
	"PoX-4 decoding is disabled (POX4_DECODER_ENABLED=false); cycle data is unavailable until re-enabled.";

type CycleDbRow = {
	reward_cycle: number;
	total_stacked_ustx: string;
	unique_stackers: number;
	unique_delegators: number;
	action_count: number;
	start_block_height: number;
	end_block_height: number;
	max_cycle: number;
	function_breakdown: Record<string, number>;
};

function normalizeCycle(row: CycleDbRow): PoxCycle {
	return {
		reward_cycle: Number(row.reward_cycle),
		total_stacked_ustx: row.total_stacked_ustx ?? "0",
		unique_stackers: Number(row.unique_stackers),
		unique_delegators: Number(row.unique_delegators),
		action_count: Number(row.action_count),
		start_block_height: Number(row.start_block_height),
		end_block_height: Number(row.end_block_height),
		is_current: Number(row.reward_cycle) === Number(row.max_cycle),
		function_breakdown: Object.entries(row.function_breakdown ?? {}).map(
			([function_name, count]) => ({ function_name, count: Number(count) }),
		),
	};
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

export async function readPoxCycles(
	query: URLSearchParams,
	db: Kysely<Database> = getSourceDb(),
): Promise<{ cycles: PoxCycle[]; next_cursor: number | null }> {
	const limit = parseCycleLimit(query.get("limit"));
	const after = parseCycleCursor(query.get("cursor"));

	const afterClause =
		after !== undefined ? sql`AND p.reward_cycle < ${after}` : sql``;

	const { rows } = await sql<CycleDbRow>`
		WITH fn_counts AS (
			SELECT reward_cycle, function_name, COUNT(*)::int AS cnt
			FROM pox4_calls
			WHERE canonical = true AND reward_cycle IS NOT NULL
			GROUP BY reward_cycle, function_name
		),
		fn_breakdown AS (
			SELECT reward_cycle,
				jsonb_object_agg(function_name, cnt) AS function_breakdown
			FROM fn_counts
			GROUP BY reward_cycle
		),
		max_cycle AS (
			SELECT MAX(reward_cycle) AS val
			FROM pox4_calls
			WHERE canonical = true AND reward_cycle IS NOT NULL
		)
		SELECT
			p.reward_cycle,
			COALESCE(
				SUM(p.amount_ustx::numeric) FILTER (WHERE p.amount_ustx IS NOT NULL),
				0
			)::text AS total_stacked_ustx,
			COUNT(DISTINCT p.stacker) FILTER (WHERE p.stacker IS NOT NULL)::int AS unique_stackers,
			COUNT(DISTINCT p.caller) FILTER (
				WHERE p.function_name LIKE 'delegate-%'
			)::int AS unique_delegators,
			COUNT(*)::int AS action_count,
			MIN(p.block_height)::int AS start_block_height,
			MAX(p.block_height)::int AS end_block_height,
			m.val::int AS max_cycle,
			f.function_breakdown
		FROM pox4_calls p
		JOIN fn_breakdown f ON f.reward_cycle = p.reward_cycle
		CROSS JOIN max_cycle m
		WHERE p.canonical = true
		  AND p.reward_cycle IS NOT NULL
		  ${afterClause}
		GROUP BY p.reward_cycle, f.function_breakdown, m.val
		ORDER BY p.reward_cycle DESC
		LIMIT ${limit + 1}
	`.execute(db);

	const cycles = rows.slice(0, limit).map(normalizeCycle);
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
): Promise<PoxCycle | null> {
	const { rows } = await sql<CycleDbRow>`
		WITH fn_counts AS (
			SELECT function_name, COUNT(*)::int AS cnt
			FROM pox4_calls
			WHERE canonical = true AND reward_cycle = ${rewardCycle}
			GROUP BY function_name
		),
		fn_breakdown AS (
			SELECT jsonb_object_agg(function_name, cnt) AS function_breakdown
			FROM fn_counts
		),
		max_cycle AS (
			SELECT MAX(reward_cycle)::int AS val
			FROM pox4_calls
			WHERE canonical = true AND reward_cycle IS NOT NULL
		)
		SELECT
			${rewardCycle}::int AS reward_cycle,
			COALESCE(
				SUM(p.amount_ustx::numeric) FILTER (WHERE p.amount_ustx IS NOT NULL),
				0
			)::text AS total_stacked_ustx,
			COUNT(DISTINCT p.stacker) FILTER (WHERE p.stacker IS NOT NULL)::int AS unique_stackers,
			COUNT(DISTINCT p.caller) FILTER (
				WHERE p.function_name LIKE 'delegate-%'
			)::int AS unique_delegators,
			COUNT(*)::int AS action_count,
			MIN(p.block_height)::int AS start_block_height,
			MAX(p.block_height)::int AS end_block_height,
			m.val AS max_cycle,
			f.function_breakdown
		FROM pox4_calls p
		CROSS JOIN fn_breakdown f
		CROSS JOIN max_cycle m
		WHERE p.canonical = true AND p.reward_cycle = ${rewardCycle}
	`.execute(db);

	const row = rows[0];
	if (!row || row.action_count === 0) return null;
	return normalizeCycle(row);
}

export async function getPoxCyclesResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	decoderEnabled?: boolean;
}): Promise<PoxCyclesResponse> {
	const enabled = opts.decoderEnabled ?? isPox4DecoderEnabled();
	const note = enabled ? undefined : POX4_DISABLED_NOTE;
	if (!enabled) {
		return { cycles: [], next_cursor: null, tip: opts.tip, notes: note };
	}
	const { cycles, next_cursor } = await readPoxCycles(opts.query);
	return {
		cycles,
		next_cursor,
		tip: opts.tip,
		...(note ? { notes: note } : {}),
	};
}

export async function getPoxCycleResponse(opts: {
	rewardCycle: number;
	tip: IndexTip;
	decoderEnabled?: boolean;
}): Promise<PoxCycleResponse | null> {
	const enabled = opts.decoderEnabled ?? isPox4DecoderEnabled();
	const note = enabled ? undefined : POX4_DISABLED_NOTE;
	if (!enabled) {
		return null;
	}
	const cycle = await readPoxCycle(opts.rewardCycle);
	if (!cycle) return null;
	return {
		cycle,
		tip: opts.tip,
		...(note ? { notes: note } : {}),
	};
}
