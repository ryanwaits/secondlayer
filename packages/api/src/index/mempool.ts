import { decodeClarityValue } from "@secondlayer/sdk";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import { parseFilter, parseLimit, toIsoOrNull } from "./_shared.ts";
import type { IndexTip } from "./tip.ts";
import { type DecodedTx, decodeTransaction } from "./transaction-decode.ts";

export const MEMPOOL_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"sender",
	"type",
] as const;

/** A pending (unconfirmed) transaction. The columnar fields plus `raw_tx`
 *  enrichment — but pre-chain, so no block_height/tx_index/result/events; the
 *  cursor is the mempool insertion sequence, not a block position. */
export type MempoolTransaction = {
	cursor: string;
	tx_id: string;
	tx_type: string;
	sender: string;
	received_at: string | null;
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
	};
	token_transfer?: { recipient: string; amount: string; memo: string };
	smart_contract?: { clarity_version: number | null };
	coinbase?: { alt_recipient: string | null };
	tenure_change?: { cause: number };
};

export type MempoolResponse = {
	mempool: MempoolTransaction[];
	next_cursor: string | null;
	tip: IndexTip;
};

export type MempoolQuery = {
	after?: number;
	cursorRaw?: string;
	limit: number;
	sender?: string;
	type?: string;
};

export type ReadMempoolParams = {
	after?: number;
	limit: number;
	sender?: string;
	type?: string;
	db?: Kysely<Database>;
};

export type ReadMempoolResult = {
	mempool: MempoolTransaction[];
	next_cursor: string | null;
};

export type MempoolReader = (
	params: ReadMempoolParams,
) => Promise<ReadMempoolResult>;

export type MempoolByIdReader = (
	txId: string,
) => Promise<MempoolTransaction | null>;

type MempoolDbRow = {
	seq: string | number;
	tx_id: string;
	raw_tx: string;
	type: string;
	sender: string;
	contract_id: string | null;
	function_name: string | null;
	function_args: unknown;
	received_at: Date | string | null;
};

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

function normalizeMempool(row: MempoolDbRow): MempoolTransaction {
	const decoded = decodeTransaction(row.raw_tx);
	const txType = decoded?.tx_type ?? row.type;

	const tx: MempoolTransaction = {
		cursor: String(row.seq),
		tx_id: row.tx_id,
		tx_type: txType,
		sender: row.sender,
		received_at: toIsoOrNull(row.received_at),
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
		};
	}
	if (decoded?.token_transfer) tx.token_transfer = decoded.token_transfer;
	if (txType === "smart_contract") {
		tx.smart_contract = {
			clarity_version: decoded?.smart_contract?.clarity_version ?? null,
		};
	}
	if (decoded?.coinbase) tx.coinbase = decoded.coinbase;
	if (decoded?.tenure_change) tx.tenure_change = decoded.tenure_change;

	return tx;
}

function parseMempoolCursor(value: string): number {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ValidationError("cursor must be a mempool sequence integer");
	}
	const seq = Number(value);
	if (!Number.isSafeInteger(seq)) {
		throw new ValidationError("cursor must be a mempool sequence integer");
	}
	return seq;
}

export function parseMempoolQuery(query: URLSearchParams): MempoolQuery {
	const cursorParamRaw = query.get("cursor") ?? undefined;
	const fromCursorRaw = query.get("from_cursor") ?? undefined;
	if (cursorParamRaw !== undefined && fromCursorRaw !== undefined) {
		throw new ValidationError("cursor and from_cursor are mutually exclusive");
	}
	const cursorRaw = fromCursorRaw ?? cursorParamRaw;

	return {
		after: cursorRaw ? parseMempoolCursor(cursorRaw) : undefined,
		cursorRaw,
		limit: parseLimit(query.get("limit") ?? undefined),
		sender: parseFilter(query.get("sender") ?? undefined, "sender"),
		type: parseFilter(query.get("type") ?? undefined, "type"),
	};
}

export async function readMempool(
	params: ReadMempoolParams,
): Promise<ReadMempoolResult> {
	const db = params.db ?? getSourceDb();
	const predicates: RawBuilder<unknown>[] = [];
	if (params.after !== undefined) predicates.push(sql`seq > ${params.after}`);
	if (params.sender) predicates.push(sql`sender = ${params.sender}`);
	if (params.type) predicates.push(sql`type = ${params.type}`);
	const where =
		predicates.length > 0
			? sql`WHERE ${sql.join(predicates, sql` AND `)}`
			: sql``;

	const { rows } = await sql<MempoolDbRow>`
		SELECT
			seq, tx_id, raw_tx, type, sender,
			contract_id, function_name, function_args, received_at
		FROM mempool_transactions
		${where}
		ORDER BY seq ASC
		LIMIT ${params.limit}
	`.execute(db);

	const mempool = rows.map(normalizeMempool);
	const last = mempool.at(-1);
	return { mempool, next_cursor: last ? last.cursor : null };
}

export async function readMempoolByTxId(
	txId: string,
	db: Kysely<Database> = getSourceDb(),
): Promise<MempoolTransaction | null> {
	const { rows } = await sql<MempoolDbRow>`
		SELECT
			seq, tx_id, raw_tx, type, sender,
			contract_id, function_name, function_args, received_at
		FROM mempool_transactions
		WHERE tx_id = ${txId}
		LIMIT 1
	`.execute(db);
	const row = rows.at(0);
	return row ? normalizeMempool(row) : null;
}

export async function getMempoolResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readMempool?: MempoolReader;
}): Promise<MempoolResponse> {
	const parsed = parseMempoolQuery(opts.query);
	const reader = opts.readMempool ?? readMempool;
	const result = await reader({
		after: parsed.after,
		limit: parsed.limit,
		sender: parsed.sender,
		type: parsed.type,
	});
	return {
		mempool: result.mempool,
		next_cursor: result.next_cursor,
		tip: opts.tip,
	};
}
