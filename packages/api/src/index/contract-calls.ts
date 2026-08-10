import { decodeClarityValue } from "@secondlayer/sdk";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { resolveTraitContractIds } from "@secondlayer/shared/db/queries/contracts";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import type { StreamsReorg } from "../streams/reorgs.ts";
import {
	type IndexTxCursorInput,
	jsonSafeBigInt,
	parseFilter,
	parseIndexBaseQuery,
	parseListFilter,
	parseTxIndexCursor,
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
	"trait",
] as const;

export type ContractCallCursor = IndexTxCursorInput;

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
	/** Set only when `contract_id` carried more than one value. */
	contractIds?: string[];
	functionName?: string;
	sender?: string;
	/** Restrict to contracts conforming to this trait/standard (resolved as-of toHeight). */
	trait?: string;
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
	/** Scope to several contracts at once (emitted as an IN list). */
	contractIds?: readonly string[];
	functionName?: string;
	sender?: string;
	/** Restrict to contracts conforming to this trait/standard (resolved as-of toHeight). */
	trait?: string;
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

export function parseContractCallsQuery(
	query: URLSearchParams,
	tip: IndexTip,
): ContractCallsQuery {
	// Base first, so a request that violates both the cursor rules and the
	// contract_id rules still reports the cursor error it always reported.
	const base = parseIndexBaseQuery(query, tip, parseTxIndexCursor);
	const contractIds = parseListFilter(
		query.get("contract_id") ?? undefined,
		"contract_id",
	);

	return {
		...base,
		// One id keeps the scalar equality; several become an IN scope. Ordering
		// here is fixed on (block_height, tx_index), so unlike /events the list
		// form needs no special handling beyond the predicate.
		contractId: contractIds?.length === 1 ? contractIds[0] : undefined,
		contractIds:
			contractIds && contractIds.length > 1 ? contractIds : undefined,
		functionName: parseFilter(
			query.get("function_name") ?? undefined,
			"function_name",
		),
		sender: parseFilter(query.get("sender") ?? undefined, "sender"),
		trait: parseTrait(query, contractIds),
	};
}

/** Trait filter is mutually exclusive with an explicit contract_id. */
function parseTrait(
	query: URLSearchParams,
	contractIds: string[] | undefined,
): string | undefined {
	const trait = parseFilter(query.get("trait") ?? undefined, "trait");
	if (trait !== undefined && contractIds !== undefined) {
		throw new ValidationError("trait and contract_id are mutually exclusive");
	}
	return trait;
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
	// Deep BigInt→string over the whole row — decoded Clarity args/result carry
	// bigints that throw in JSON.stringify (c.json + ETag).
	return jsonSafeBigInt({
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
	});
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
	if (params.contractIds && params.contractIds.length > 0) {
		predicates.push(
			sql`t.contract_id IN (${sql.join(
				params.contractIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);
	}
	if (params.functionName) {
		predicates.push(sql`t.function_name = ${params.functionName}`);
	}
	if (params.sender) {
		predicates.push(sql`t.sender = ${params.sender}`);
	}
	if (params.trait) {
		const ids = await resolveTraitContractIds(
			db,
			params.trait,
			params.toHeight,
		);
		if (ids.length === 0) return { contract_calls: [], next_cursor: null };
		predicates.push(
			sql`t.contract_id IN (${sql.join(
				ids.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);
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
	// Cursor from the RAW rows, pre-normalization: the day this resource gains
	// `fields`, a cursor read off projected rows is the pox5 bug again.
	const lastRow = pageRows.at(-1);

	return {
		contract_calls,
		next_cursor: lastRow
			? `${Number(lastRow.block_height)}:${Number(lastRow.tx_index)}`
			: null,
	};
}

export async function getContractCallsResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readContractCalls?: ContractCallsReader;
	readReorgs?: (range: {
		fromHeight: number;
		toHeight: number;
	}) => Promise<StreamsReorg[]>;
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
		contractIds: parsed.contractIds,
		functionName: parsed.functionName,
		sender: parsed.sender,
		trait: parsed.trait,
	});

	// Height-granular reorg reconciliation (cursor is block_height:tx_index, not
	// event-indexed). Over-inclusive, never under-reports. Empty page → no lookup.
	const reorgReader = opts.readReorgs ?? (async () => []);
	const heights = result.contract_calls.map((c) => c.block_height);
	const reorgs =
		heights.length > 0
			? await reorgReader({
					fromHeight: Math.min(...heights),
					toHeight: Math.max(...heights),
				})
			: [];

	return {
		contract_calls: result.contract_calls,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
	};
}
