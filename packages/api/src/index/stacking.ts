import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import {
	parseFilter,
	parseLimit,
	parseNonNegativeInteger,
	toIsoOrNull,
} from "./_shared.ts";
import type { IndexTip } from "./tip.ts";

export const STACKING_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"function_name",
	"stacker",
	"caller",
] as const;

export type StackingCursor = {
	block_height: number;
	tx_index: number;
};

/** A decoded PoX-4 stacking action. One row per stacking contract call
 *  (stack-stx, delegate-stx, stack-aggregation-commit, …). */
export type StackingAction = {
	cursor: string;
	block_height: number;
	block_time?: string | null;
	burn_block_height: number;
	tx_id: string;
	tx_index: number;
	function_name: string;
	caller: string;
	stacker: string | null;
	delegate_to: string | null;
	amount_ustx: string | null;
	lock_period: number | null;
	pox_addr: {
		version: number | null;
		hashbytes: string | null;
		btc: string | null;
	};
	start_cycle: number | null;
	end_cycle: number | null;
	reward_cycle: number | null;
	signer_key: string | null;
	result_ok: boolean;
};

export type StackingResponse = {
	stacking: StackingAction[];
	next_cursor: string | null;
	tip: IndexTip;
	/** Present only when the PoX-4 decoder is disabled, explaining an empty feed. */
	notes?: string;
};

export type StackingQuery = {
	cursor?: StackingCursor;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	functionName?: string;
	stacker?: string;
	caller?: string;
	cursorPastTip: boolean;
};

export type ReadStackingParams = {
	after?: StackingCursor;
	fromHeight: number;
	toHeight: number;
	limit: number;
	functionName?: string;
	stacker?: string;
	caller?: string;
	db?: Kysely<Database>;
};

export type ReadStackingResult = {
	stacking: StackingAction[];
	next_cursor: string | null;
};

export type StackingReader = (
	params: ReadStackingParams,
) => Promise<ReadStackingResult>;

type StackingDbRow = {
	block_height: string | number;
	block_time: Date | string | null;
	burn_block_height: string | number;
	tx_id: string;
	tx_index: string | number;
	function_name: string;
	caller: string;
	stacker: string | null;
	delegate_to: string | null;
	amount_ustx: string | null;
	lock_period: number | null;
	pox_addr_version: number | null;
	pox_addr_hashbytes: string | null;
	pox_addr_btc: string | null;
	start_cycle: number | null;
	end_cycle: number | null;
	reward_cycle: number | null;
	signer_key: string | null;
	result_ok: boolean;
};

/** PoX-4 decoding is opt-in (it feeds the datasets surface go-forward). When
 *  off, `pox4_calls` is empty and the endpoint says so rather than implying the
 *  network had no stacking activity. */
export function isPox4DecoderEnabled(): boolean {
	return process.env.POX4_DECODER_ENABLED === "true";
}

const POX4_DISABLED_NOTE =
	"PoX-4 decoding is disabled (POX4_DECODER_ENABLED is not set); stacking is empty until enabled.";

function normalizeStacking(row: StackingDbRow): StackingAction {
	const blockHeight = Number(row.block_height);
	const txIndex = Number(row.tx_index);
	return {
		cursor: `${blockHeight}:${txIndex}`,
		block_height: blockHeight,
		block_time: toIsoOrNull(row.block_time),
		burn_block_height: Number(row.burn_block_height),
		tx_id: row.tx_id,
		tx_index: txIndex,
		function_name: row.function_name,
		caller: row.caller,
		stacker: row.stacker,
		delegate_to: row.delegate_to,
		amount_ustx: row.amount_ustx,
		lock_period: row.lock_period,
		pox_addr: {
			version: row.pox_addr_version,
			hashbytes: row.pox_addr_hashbytes,
			btc: row.pox_addr_btc,
		},
		start_cycle: row.start_cycle,
		end_cycle: row.end_cycle,
		reward_cycle: row.reward_cycle,
		signer_key: row.signer_key,
		result_ok: row.result_ok,
	};
}

export async function readStacking(
	params: ReadStackingParams,
): Promise<ReadStackingResult> {
	if (params.toHeight < params.fromHeight) {
		return { stacking: [], next_cursor: null };
	}

	const db = params.db ?? getSourceDb();
	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`block_height >= ${params.fromHeight}`,
		sql`block_height <= ${params.toHeight}`,
	];

	if (params.functionName) {
		predicates.push(sql`function_name = ${params.functionName}`);
	}
	if (params.stacker) predicates.push(sql`stacker = ${params.stacker}`);
	if (params.caller) predicates.push(sql`caller = ${params.caller}`);
	if (params.after) {
		predicates.push(sql`
			(
				block_height > ${params.after.block_height}
				OR (
					block_height = ${params.after.block_height}
					AND tx_index > ${params.after.tx_index}
				)
			)
		`);
	}

	const { rows } = await sql<StackingDbRow>`
		SELECT
			block_height,
			(
				SELECT to_timestamp(b.timestamp) AT TIME ZONE 'UTC'
				FROM blocks b
				WHERE b.height = pox4_calls.block_height AND b.canonical = true
				LIMIT 1
			) AS block_time,
			burn_block_height,
			tx_id,
			tx_index,
			function_name,
			caller,
			stacker,
			delegate_to,
			amount_ustx,
			lock_period,
			pox_addr_version,
			pox_addr_hashbytes,
			pox_addr_btc,
			start_cycle,
			end_cycle,
			reward_cycle,
			signer_key,
			result_ok
		FROM pox4_calls
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY block_height ASC, tx_index ASC
		LIMIT ${params.limit}
	`.execute(db);

	const stacking = rows.map(normalizeStacking);
	const last = stacking.at(-1);
	return {
		stacking,
		next_cursor: last ? `${last.block_height}:${last.tx_index}` : null,
	};
}

function parseStackingCursor(value: string): StackingCursor {
	const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value);
	if (!match) {
		throw new ValidationError("cursor must use <block_height>:<tx_index>");
	}
	const blockHeight = Number(match[1]);
	const txIndex = Number(match[2]);
	if (!Number.isSafeInteger(blockHeight) || !Number.isSafeInteger(txIndex)) {
		throw new ValidationError("cursor must use <block_height>:<tx_index>");
	}
	return { block_height: blockHeight, tx_index: txIndex };
}

export function parseStackingQuery(
	query: URLSearchParams,
	tip: IndexTip,
): StackingQuery {
	const cursorParamRaw = query.get("cursor") ?? undefined;
	const fromCursorRaw = query.get("from_cursor") ?? undefined;
	if (cursorParamRaw !== undefined && fromCursorRaw !== undefined) {
		throw new ValidationError("cursor and from_cursor are mutually exclusive");
	}

	const cursorRaw = fromCursorRaw ?? cursorParamRaw;
	const fromHeightRaw = query.get("from_height") ?? undefined;
	if (cursorRaw && fromHeightRaw !== undefined) {
		throw new ValidationError("cursor and from_height are mutually exclusive");
	}

	const cursor = cursorRaw ? parseStackingCursor(cursorRaw) : undefined;
	const requestedFromHeight =
		fromHeightRaw !== undefined
			? parseNonNegativeInteger(fromHeightRaw, "from_height")
			: undefined;
	const requestedToHeight =
		query.get("to_height") !== null
			? parseNonNegativeInteger(query.get("to_height") as string, "to_height")
			: undefined;
	const defaultFromHeight =
		cursorRaw === undefined && fromHeightRaw === undefined
			? Math.max(0, tip.block_height - STREAMS_BLOCKS_PER_DAY)
			: undefined;

	return {
		cursor,
		cursorRaw,
		fromHeight: requestedFromHeight ?? defaultFromHeight ?? 0,
		toHeight:
			requestedToHeight === undefined
				? tip.block_height
				: Math.min(requestedToHeight, tip.block_height),
		limit: parseLimit(query.get("limit") ?? undefined),
		functionName: parseFilter(
			query.get("function_name") ?? undefined,
			"function_name",
		),
		stacker: parseFilter(query.get("stacker") ?? undefined, "stacker"),
		caller: parseFilter(query.get("caller") ?? undefined, "caller"),
		cursorPastTip: cursor ? cursor.block_height > tip.block_height : false,
	};
}

export async function getStackingResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readStacking?: StackingReader;
	decoderEnabled?: boolean;
}): Promise<StackingResponse> {
	const parsed = parseStackingQuery(opts.query, opts.tip);
	const enabled = opts.decoderEnabled ?? isPox4DecoderEnabled();
	const note = enabled ? undefined : POX4_DISABLED_NOTE;

	if (parsed.cursorPastTip) {
		return {
			stacking: [],
			next_cursor: parsed.cursorRaw ?? null,
			tip: opts.tip,
			...(note ? { notes: note } : {}),
		};
	}

	const reader = opts.readStacking ?? readStacking;
	const result = await reader({
		after: parsed.cursor,
		fromHeight: parsed.fromHeight,
		toHeight: parsed.toHeight,
		limit: parsed.limit,
		functionName: parsed.functionName,
		stacker: parsed.stacker,
		caller: parsed.caller,
	});

	return {
		stacking: result.stacking,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		...(note ? { notes: note } : {}),
	};
}
