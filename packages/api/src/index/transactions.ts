import { decodeClarityValue } from "@secondlayer/sdk";
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
import { type DecodedTx, decodeTransaction } from "./transaction-decode.ts";

export const TRANSACTIONS_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"type",
	"sender",
	"contract_id",
] as const;

export type TransactionCursor = {
	block_height: number;
	tx_index: number;
};

/** The full transaction document: the columnar fields from `transactions` plus
 *  the `raw_tx`-decoded enrichment (fee/nonce/post-conditions/payload detail).
 *  Payload sub-objects are present only for the matching `tx_type`. Enrichment
 *  fields are null when `raw_tx` isn't decodable (e.g. burnchain ops). */
export type IndexTransaction = {
	cursor: string;
	tx_id: string;
	block_height: number;
	block_time?: string | null;
	tx_index: number;
	tx_type: string;
	sender: string;
	status: string;
	fee: string | null;
	nonce: string | null;
	sponsored: boolean | null;
	anchor_mode: string | null;
	post_condition_mode: string | null;
	post_conditions: DecodedTx["post_conditions"];
	contract_call?: {
		contract_id: string;
		function_name: string;
		function_args: unknown[];
		// Raw hex-encoded ClarityValues, for consumers that decode themselves
		// (e.g. the subgraph runtime). decode(function_args_hex[i]) === function_args[i].
		function_args_hex: string[];
		result: unknown;
		result_hex: string | null;
	};
	token_transfer?: { recipient: string; amount: string; memo: string };
	smart_contract?: {
		contract_id: string | null;
		clarity_version: number | null;
	};
	coinbase?: { alt_recipient: string | null };
	tenure_change?: { cause: number };
};

export type TransactionsQuery = {
	cursor?: TransactionCursor;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	type?: string;
	sender?: string;
	contractId?: string;
	cursorPastTip: boolean;
};

export type TransactionsResponse = {
	transactions: IndexTransaction[];
	next_cursor: string | null;
	tip: IndexTip;
	reorgs: never[];
};

export type ReadTransactionsParams = {
	after?: TransactionCursor;
	fromHeight: number;
	toHeight: number;
	limit: number;
	type?: string;
	sender?: string;
	contractId?: string;
	db?: Kysely<Database>;
};

export type ReadTransactionsResult = {
	transactions: IndexTransaction[];
	next_cursor: string | null;
};

export type TransactionsReader = (
	params: ReadTransactionsParams,
) => Promise<ReadTransactionsResult>;

export type TransactionByIdReader = (
	txId: string,
) => Promise<IndexTransaction | null>;

type TransactionDbRow = {
	block_height: string | number;
	block_time: Date | string | null;
	tx_id: string;
	tx_index: string | number;
	type: string;
	sender: string;
	status: string;
	contract_id: string | null;
	function_name: string | null;
	function_args: unknown;
	raw_result: string | null;
	raw_tx: string;
};

const TRANSACTION_COLUMNS = sql`
	t.block_height,
	(
		SELECT to_timestamp(b.timestamp) AT TIME ZONE 'UTC'
		FROM blocks b
		WHERE b.height = t.block_height AND b.canonical = true
		LIMIT 1
	) AS block_time,
	t.tx_id,
	t.tx_index,
	t.type,
	t.sender,
	t.status,
	t.contract_id,
	t.function_name,
	t.function_args,
	t.raw_result,
	t.raw_tx
`;

/** function_args is a JSONB array of hex-encoded ClarityValues. Decode each to
 *  JSON-safe JS (mirrors the contract-calls reader). */
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

/** function_args as the raw array of hex-encoded ClarityValue strings. */
function rawArgs(raw: unknown): string[] {
	let parsed = raw;
	if (typeof parsed === "string") {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((a): a is string => typeof a === "string");
}

function decodeResult(raw: string | null): unknown {
	if (typeof raw === "string" && raw.length > 2) return decodeClarityValue(raw);
	return null;
}

function normalizeTransaction(row: TransactionDbRow): IndexTransaction {
	const blockHeight = Number(row.block_height);
	const txIndex = Number(row.tx_index);
	const decoded = decodeTransaction(row.raw_tx);
	const txType = decoded?.tx_type ?? row.type;

	const tx: IndexTransaction = {
		cursor: `${blockHeight}:${txIndex}`,
		tx_id: row.tx_id,
		block_height: blockHeight,
		block_time: toIsoOrNull(row.block_time),
		tx_index: txIndex,
		tx_type: txType,
		sender: row.sender,
		status: row.status,
		fee: decoded?.fee ?? null,
		nonce: decoded?.nonce ?? null,
		sponsored: decoded?.sponsored ?? null,
		anchor_mode: decoded?.anchor_mode ?? null,
		post_condition_mode: decoded?.post_condition_mode ?? null,
		post_conditions: decoded?.post_conditions ?? [],
	};

	if (txType === "contract_call" && row.contract_id && row.function_name) {
		tx.contract_call = {
			contract_id: row.contract_id,
			function_name: row.function_name,
			function_args: decodeArgs(row.function_args),
			function_args_hex: rawArgs(row.function_args),
			result: decodeResult(row.raw_result),
			result_hex: row.raw_result,
		};
	}
	if (decoded?.token_transfer) tx.token_transfer = decoded.token_transfer;
	if (txType === "smart_contract") {
		tx.smart_contract = {
			contract_id: row.contract_id,
			clarity_version: decoded?.smart_contract?.clarity_version ?? null,
		};
	}
	if (decoded?.coinbase) tx.coinbase = decoded.coinbase;
	if (decoded?.tenure_change) tx.tenure_change = decoded.tenure_change;

	return tx;
}

export function parseTransactionCursor(value: string): TransactionCursor {
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

export function parseTransactionsQuery(
	query: URLSearchParams,
	tip: IndexTip,
): TransactionsQuery {
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

	const cursor = cursorRaw ? parseTransactionCursor(cursorRaw) : undefined;
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
		type: parseFilter(query.get("type") ?? undefined, "type"),
		sender: parseFilter(query.get("sender") ?? undefined, "sender"),
		contractId: parseFilter(
			query.get("contract_id") ?? undefined,
			"contract_id",
		),
		cursorPastTip: cursor ? cursor.block_height > tip.block_height : false,
	};
}

export async function readTransactions(
	params: ReadTransactionsParams,
): Promise<ReadTransactionsResult> {
	if (params.toHeight < params.fromHeight) {
		return { transactions: [], next_cursor: null };
	}

	const db = params.db ?? getSourceDb();
	// transactions has no canonical column; canonicality is keyed off the block
	// at that height (same approach as the contract-calls reader).
	const predicates: RawBuilder<unknown>[] = [
		sql`t.block_height >= ${params.fromHeight}`,
		sql`t.block_height <= ${params.toHeight}`,
		sql`EXISTS (
			SELECT 1 FROM blocks b
			WHERE b.height = t.block_height AND b.canonical = true
		)`,
	];

	if (params.type) predicates.push(sql`t.type = ${params.type}`);
	if (params.sender) predicates.push(sql`t.sender = ${params.sender}`);
	if (params.contractId) {
		predicates.push(sql`t.contract_id = ${params.contractId}`);
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

	const { rows } = await sql<TransactionDbRow>`
		SELECT ${TRANSACTION_COLUMNS}
		FROM transactions t
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY t.block_height ASC, t.tx_index ASC
		LIMIT ${params.limit}
	`.execute(db);

	const transactions = rows.map(normalizeTransaction);
	const last = transactions.at(-1);

	return {
		transactions,
		next_cursor: last ? `${last.block_height}:${last.tx_index}` : null,
	};
}

export async function readTransactionById(
	txId: string,
	db: Kysely<Database> = getSourceDb(),
): Promise<IndexTransaction | null> {
	const { rows } = await sql<TransactionDbRow>`
		SELECT ${TRANSACTION_COLUMNS}
		FROM transactions t
		WHERE t.tx_id = ${txId}
			AND EXISTS (
				SELECT 1 FROM blocks b
				WHERE b.height = t.block_height AND b.canonical = true
			)
		LIMIT 1
	`.execute(db);

	const row = rows.at(0);
	return row ? normalizeTransaction(row) : null;
}

export async function getTransactionsResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readTransactions?: TransactionsReader;
}): Promise<TransactionsResponse> {
	const parsed = parseTransactionsQuery(opts.query, opts.tip);

	if (parsed.cursorPastTip) {
		return {
			transactions: [],
			next_cursor: parsed.cursorRaw ?? null,
			tip: opts.tip,
			reorgs: [],
		};
	}

	const reader = opts.readTransactions ?? readTransactions;
	const result = await reader({
		after: parsed.cursor,
		fromHeight: parsed.fromHeight,
		toHeight: parsed.toHeight,
		limit: parsed.limit,
		type: parsed.type,
		sender: parsed.sender,
		contractId: parsed.contractId,
	});

	// Cursor keyspace is block_height:tx_index, which the event-indexed reorg
	// reader can't address — transactions always returns reorgs: [].
	return {
		transactions: result.transactions,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs: [],
	};
}
