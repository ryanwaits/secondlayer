import { decodeClarityValue } from "@secondlayer/sdk";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import type { StreamsReorg } from "../streams/reorgs.ts";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import {
	parseFilter,
	parseLimit,
	parseNonNegativeInteger,
	toIsoOrNull,
} from "./_shared.ts";
import type { IndexTip } from "./tip.ts";

export const CONTRACT_CALLS_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"contract_id",
	"function_name",
	"sender",
] as const;

export type ContractCallCursor = {
	block_height: number;
	tx_index: number;
};

export type ContractCall = {
	cursor: string;
	block_height: number;
	block_time?: string | null;
	tx_id: string;
	tx_index: number;
	contract_id: string;
	function_name: string;
	sender: string;
	status: string;
	args: unknown[];
	result: unknown;
	result_hex: string | null;
};

export type ContractCallsQuery = {
	cursor?: ContractCallCursor;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	contractId?: string;
	functionName?: string;
	sender?: string;
	cursorPastTip: boolean;
};

export type ContractCallsResponse = {
	contract_calls: ContractCall[];
	next_cursor: string | null;
	tip: IndexTip;
	reorgs: StreamsReorg[];
};

export type ReadContractCallsParams = {
	after?: ContractCallCursor;
	fromHeight: number;
	toHeight: number;
	limit: number;
	contractId?: string;
	functionName?: string;
	sender?: string;
	db?: Kysely<Database>;
};

export type ReadContractCallsResult = {
	contract_calls: ContractCall[];
	next_cursor: string | null;
};

export type ContractCallsReader = (
	params: ReadContractCallsParams,
) => Promise<ReadContractCallsResult>;

type ContractCallDbRow = {
	block_height: string | number;
	block_time: Date | string | null;
	tx_id: string;
	tx_index: string | number;
	contract_id: string;
	function_name: string;
	sender: string;
	status: string;
	function_args: unknown;
	raw_result: string | null;
};

function parseContractCallCursor(value: string): ContractCallCursor {
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

export function parseContractCallsQuery(
	query: URLSearchParams,
	tip: IndexTip,
): ContractCallsQuery {
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

	const cursor = cursorRaw ? parseContractCallCursor(cursorRaw) : undefined;
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
		contractId: parseFilter(
			query.get("contract_id") ?? undefined,
			"contract_id",
		),
		functionName: parseFilter(
			query.get("function_name") ?? undefined,
			"function_name",
		),
		sender: parseFilter(query.get("sender") ?? undefined, "sender"),
		cursorPastTip: cursor ? cursor.block_height > tip.block_height : false,
	};
}

/** function_args is a JSONB array of hex-encoded ClarityValues (postgres.js may
 *  hand it back as an object or a JSON string). Decode each to JSON-safe JS. */
function decodeArgs(raw: unknown): unknown[] {
	let parsed = raw;
	if (typeof parsed === "string") {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.map((arg) =>
		typeof arg === "string" ? decodeClarityValue(arg) : arg,
	);
}

function decodeResult(raw: string | null): unknown {
	if (typeof raw === "string" && raw.length > 2) return decodeClarityValue(raw);
	return null;
}

function normalizeRow(row: ContractCallDbRow): ContractCall {
	const blockHeight = Number(row.block_height);
	const txIndex = Number(row.tx_index);
	return {
		cursor: `${blockHeight}:${txIndex}`,
		block_height: blockHeight,
		block_time: toIsoOrNull(row.block_time),
		tx_id: row.tx_id,
		tx_index: txIndex,
		contract_id: row.contract_id,
		function_name: row.function_name,
		sender: row.sender,
		status: row.status,
		args: decodeArgs(row.function_args),
		result: decodeResult(row.raw_result),
		result_hex: row.raw_result,
	};
}

export async function readContractCalls(
	params: ReadContractCallsParams,
): Promise<ReadContractCallsResult> {
	if (params.toHeight < params.fromHeight) {
		return { contract_calls: [], next_cursor: null };
	}

	const db = params.db ?? getSourceDb();
	// transactions has no canonical column, so canonicality is keyed off the
	// block at that height. Rare reorg edge: a contract_call that was orphaned
	// but not re-mined can linger at a height that now has a different canonical
	// block; acceptable given contract-calls returns reorgs: [].
	const predicates: RawBuilder<unknown>[] = [
		sql`t.type = 'contract_call'`,
		sql`t.contract_id IS NOT NULL`,
		sql`t.function_name IS NOT NULL`,
		sql`t.block_height >= ${params.fromHeight}`,
		sql`t.block_height <= ${params.toHeight}`,
		sql`EXISTS (
			SELECT 1 FROM blocks b
			WHERE b.height = t.block_height AND b.canonical = true
		)`,
	];

	if (params.contractId) {
		predicates.push(sql`t.contract_id = ${params.contractId}`);
	}
	if (params.functionName) {
		predicates.push(sql`t.function_name = ${params.functionName}`);
	}
	if (params.sender) {
		predicates.push(sql`t.sender = ${params.sender}`);
	}
	if (params.after) {
		predicates.push(sql`
			(
				t.block_height > ${params.after.block_height}
				OR (
					t.block_height = ${params.after.block_height}
					AND t.tx_index > ${params.after.tx_index}
				)
			)
		`);
	}

	const { rows } = await sql<ContractCallDbRow>`
		SELECT
			t.block_height,
			(
				SELECT to_timestamp(b.timestamp) AT TIME ZONE 'UTC'
				FROM blocks b
				WHERE b.height = t.block_height AND b.canonical = true
				LIMIT 1
			) AS block_time,
			t.tx_id,
			t.tx_index,
			t.contract_id,
			t.function_name,
			t.sender,
			t.status,
			t.function_args,
			t.raw_result
		FROM transactions t
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY t.block_height ASC, t.tx_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const pageRows = rows.slice(0, params.limit);
	const contract_calls = pageRows.map(normalizeRow);
	const last = contract_calls.at(-1);

	return {
		contract_calls,
		next_cursor: last ? `${last.block_height}:${last.tx_index}` : null,
	};
}

export async function getContractCallsResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readContractCalls?: ContractCallsReader;
}): Promise<ContractCallsResponse> {
	const parsed = parseContractCallsQuery(opts.query, opts.tip);

	if (parsed.cursorPastTip) {
		return {
			contract_calls: [],
			next_cursor: parsed.cursorRaw ?? null,
			tip: opts.tip,
			reorgs: [],
		};
	}

	const reader = opts.readContractCalls ?? readContractCalls;
	const result = await reader({
		after: parsed.cursor,
		fromHeight: parsed.fromHeight,
		toHeight: parsed.toHeight,
		limit: parsed.limit,
		contractId: parsed.contractId,
		functionName: parsed.functionName,
		sender: parsed.sender,
	});

	// Cursor keyspace here is block_height:tx_index, which the event-indexed
	// reorg reader can't address — contract-calls always returns reorgs: [].
	return {
		contract_calls: result.contract_calls,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs: [],
	};
}
