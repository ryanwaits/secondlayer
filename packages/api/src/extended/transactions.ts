import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import { decodeTransaction } from "../index/transaction-decode.ts";

/**
 * Hiro-ish transaction. post_conditions omitted — DecodedPostCondition shape
 * (numeric condition_code + condition_code_name) is not Hiro's
 * `{ principal, condition_code: string, ... }` wire form.
 * Enrichment fields omitted when raw_tx does not decode.
 */
export type ExtendedTx = {
	tx_id: string;
	tx_index: number;
	tx_status: string;
	tx_type: string;
	sender_address: string;
	block_height: number;
	block_hash?: string | null;
	burn_block_time?: number | null;
	canonical?: boolean;
	fee_rate?: string;
	nonce?: number;
	sponsored?: boolean;
	anchor_mode?: string | null;
	post_condition_mode?: string | null;
	token_transfer?: { recipient: string; amount: string; memo: string };
	contract_call?: { contract_id: string; function_name: string };
	smart_contract?: {
		contract_id: string | null;
		clarity_version: number | null;
	};
	coinbase?: { alt_recipient: string | null };
	tenure_change?: { cause: number };
};

export type ListExtendedTransactionsQuery = {
	limit: number;
	offset: number;
	fromHeight?: number;
	toHeight?: number;
	/** Match `transactions.sender` (address tx list). */
	sender?: string;
};

export type ListExtendedTransactionsResult = {
	results: ExtendedTx[];
	total: number;
};

export type ListExtendedTransactions = (
	q: ListExtendedTransactionsQuery,
) => Promise<ListExtendedTransactionsResult>;

export type GetExtendedTransaction = (
	txId: string,
) => Promise<ExtendedTx | null>;

type TxDbRow = {
	tx_id: string;
	tx_index: string | number;
	type: string;
	sender: string;
	status: string;
	block_height: string | number;
	contract_id: string | null;
	function_name: string | null;
	raw_tx: string;
	block_hash: string | null;
	burn_block_time: string | number | null;
	canonical: boolean | null;
};

function projectTx(row: TxDbRow): ExtendedTx {
	const decoded = decodeTransaction(row.raw_tx);
	const txType = decoded?.tx_type ?? row.type;
	const blockHeight = Number(row.block_height);

	const tx: ExtendedTx = {
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		tx_status: row.status,
		tx_type: txType,
		sender_address: row.sender,
		block_height: blockHeight,
	};

	if (row.block_hash != null) tx.block_hash = row.block_hash;
	if (row.burn_block_time != null) {
		tx.burn_block_time = Number(row.burn_block_time);
	}
	if (row.canonical != null) tx.canonical = row.canonical;

	if (decoded) {
		tx.fee_rate = decoded.fee;
		const nonce = Number.parseInt(decoded.nonce, 10);
		if (Number.isSafeInteger(nonce)) tx.nonce = nonce;
		tx.sponsored = decoded.sponsored;
		if (decoded.anchor_mode != null) tx.anchor_mode = decoded.anchor_mode;
		if (decoded.post_condition_mode != null) {
			tx.post_condition_mode = decoded.post_condition_mode;
		}
		if (decoded.token_transfer) tx.token_transfer = decoded.token_transfer;
		if (decoded.coinbase) tx.coinbase = decoded.coinbase;
		if (decoded.tenure_change) tx.tenure_change = decoded.tenure_change;
	}

	if (txType === "contract_call" && row.contract_id && row.function_name) {
		tx.contract_call = {
			contract_id: row.contract_id,
			function_name: row.function_name,
		};
	}
	if (txType === "smart_contract") {
		tx.smart_contract = {
			contract_id: row.contract_id,
			clarity_version: decoded?.smart_contract?.clarity_version ?? null,
		};
	}

	return tx;
}

/** Optional from_height / to_height integers from query string. */
export function parseTxHeightFilters(
	query: Record<string, string | undefined>,
): {
	fromHeight?: number;
	toHeight?: number;
} {
	const out: { fromHeight?: number; toHeight?: number } = {};
	if (query.from_height !== undefined && query.from_height !== "") {
		out.fromHeight = parseHeight(query.from_height, "from_height");
	}
	if (query.to_height !== undefined && query.to_height !== "") {
		out.toHeight = parseHeight(query.to_height, "to_height");
	}
	return out;
}

function parseHeight(raw: string, name: string): number {
	if (!/^(0|[1-9]\d*)$/.test(raw)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}
	const n = Number(raw);
	if (!Number.isSafeInteger(n)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}
	return n;
}

const TX_SELECT = sql`
	t.tx_id,
	t.tx_index,
	t.type,
	t.sender,
	t.status,
	t.block_height,
	t.contract_id,
	t.function_name,
	t.raw_tx,
	b.hash AS block_hash,
	b.timestamp AS burn_block_time,
	b.canonical AS canonical
`;

/** Canonical-only list (join canonical blocks). Height desc, tx_index desc. */
export async function listExtendedTransactions(
	q: ListExtendedTransactionsQuery,
	db: Kysely<Database> = getSourceDb(),
): Promise<ListExtendedTransactionsResult> {
	const predicates: RawBuilder<unknown>[] = [sql`b.canonical = true`];
	if (q.fromHeight !== undefined) {
		predicates.push(sql`t.block_height >= ${q.fromHeight}`);
	}
	if (q.toHeight !== undefined) {
		predicates.push(sql`t.block_height <= ${q.toHeight}`);
	}
	if (q.sender !== undefined) {
		predicates.push(sql`t.sender = ${q.sender}`);
	}

	const { rows: countRows } = await sql<{ count: string | number }>`
		SELECT COUNT(*)::bigint AS count
		FROM transactions t
		INNER JOIN blocks b ON b.height = t.block_height
		WHERE ${sql.join(predicates, sql` AND `)}
	`.execute(db);
	const total = Number(countRows[0]?.count ?? 0);

	const { rows } = await sql<TxDbRow>`
		SELECT ${TX_SELECT}
		FROM transactions t
		INNER JOIN blocks b ON b.height = t.block_height
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY t.block_height DESC, t.tx_index DESC
		LIMIT ${q.limit}
		OFFSET ${q.offset}
	`.execute(db);

	return {
		results: rows.map(projectTx),
		total,
	};
}

/** Prefer canonical block row (same as Index readTransactionById). */
export async function getExtendedTransaction(
	txId: string,
	db: Kysely<Database> = getSourceDb(),
): Promise<ExtendedTx | null> {
	const { rows } = await sql<TxDbRow>`
		SELECT ${TX_SELECT}
		FROM transactions t
		INNER JOIN blocks b
			ON b.height = t.block_height AND b.canonical = true
		WHERE t.tx_id = ${txId}
		LIMIT 1
	`.execute(db);

	const row = rows.at(0);
	return row ? projectTx(row) : null;
}
