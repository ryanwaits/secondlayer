import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import type { StreamsReorg, StreamsReorgsReader } from "../streams/reorgs.ts";
import {
	type IndexCursorInput,
	encodeIndexCursor,
	parseCursor,
	parseIndexBaseQuery,
	parseNonNegativeInteger,
	readReorgsForEvents,
} from "./_shared.ts";
import { type IndexTip, indexSourceWindowTip } from "./tip.ts";

/**
 * `GET /v1/index/state-writes`: the node's opt-in `state_writes` (the exact
 * MARF writes each block committed, in node order), served the way the
 * `vm_events` types are on `/v1/index/events`: source tip, cursor
 * `<block_height>:<ordinal>`, reorgs overlapped by height.
 *
 * Present only from the height this instance's node subscribed to the
 * `state_writes` observer key. Reads ride the `(block_height, ordinal)`
 * primary key; `tx_context` looks each writing tx up through
 * `transactions_block_height_idx` within its own block.
 */
export const STATE_WRITES_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"block_height",
	"contract_id",
	"tx_context",
] as const;

/** The writing transaction, joined when the read passed `tx_context=true`.
 *  Null fields for block-level writes. */
export type StateWriteTxContext = {
	tx_id: string | null;
	tx_sender: string | null;
	tx_type: string | null;
	tx_status: string | null;
	tx_contract_id: string | null;
	tx_function_name: string | null;
};

export type IndexStateWrite = {
	cursor: string;
	block_height: number;
	ordinal: number;
	/** Null for block-level writes. */
	tx_index: number | null;
	key: string;
	value_hex: string;
} & Partial<StateWriteTxContext>;

export type StateWritesResponse = {
	state_writes: IndexStateWrite[];
	next_cursor: string | null;
	tip: IndexTip;
	reorgs: StreamsReorg[];
};

export type ReadStateWritesParams = {
	/** Exclusive keyset: `event_index` is the ordinal. */
	after?: IndexCursorInput;
	fromHeight: number;
	toHeight: number;
	limit: number;
	/** Only the data map and data var writes of this contract. */
	contractId?: string;
	/** Join the writing transaction onto each row. */
	txContext?: boolean;
	db?: Kysely<Database>;
};

export type ReadStateWritesResult = {
	state_writes: IndexStateWrite[];
	next_cursor: string | null;
};

export type StateWritesReader = (
	params: ReadStateWritesParams,
) => Promise<ReadStateWritesResult>;

type StateWriteRow = {
	block_height: string | number;
	ordinal: string | number;
	tx_index: string | number | null;
	key: string;
	value_hex: string;
} & Partial<StateWriteTxContext>;

/** `<principal>.<contract-name>`, nothing else: the filter is a key prefix. */
const CONTRACT_ID = /^S[0-9A-Z]{1,40}\.[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;

/**
 * Every key a contract's data maps and vars live under (`vm::<c>::0::…`,
 * `vm::<c>::1::…`, and its FT/NFT keys). `starts_with`, not LIKE: `_` in a
 * contract name would be a wildcard.
 */
function contractKeyPrefix(contractId: string): string {
	return `vm::${contractId}::`;
}

/** The tx at `(block_height, tx_index)`, looked up inside the write's own
 *  block (one `transactions_block_height_idx` probe per block). */
const TX_CONTEXT_JOIN = sql`
	LEFT JOIN LATERAL (
		SELECT t.tx_id, t.sender AS tx_sender, t.type AS tx_type,
			t.status AS tx_status, t.contract_id AS tx_contract_id,
			t.function_name AS tx_function_name
		FROM transactions t
		WHERE t.block_height = sw.block_height AND t.tx_index = sw.tx_index
		LIMIT 1
	) tx ON true`;

const TX_CONTEXT_COLUMNS = sql`, tx.tx_id, tx.tx_sender, tx.tx_type, tx.tx_status, tx.tx_contract_id, tx.tx_function_name`;

/** The page query, exported so a test can EXPLAIN it. */
export function stateWritesQuery(
	params: Omit<ReadStateWritesParams, "db">,
): RawBuilder<StateWriteRow> {
	const predicates: RawBuilder<unknown>[] = [
		sql`b.canonical = true`,
		sql`sw.block_height >= ${params.fromHeight}`,
		sql`sw.block_height <= ${params.toHeight}`,
	];
	if (params.after) {
		predicates.push(
			sql`(sw.block_height, sw.ordinal) > (${params.after.block_height}, ${params.after.event_index})`,
		);
	}
	if (params.contractId) {
		predicates.push(
			sql`starts_with(sw.key, ${contractKeyPrefix(params.contractId)})`,
		);
	}
	return sql<StateWriteRow>`
		SELECT sw.block_height, sw.ordinal, sw.tx_index, sw.key, sw.value_hex
			${params.txContext ? TX_CONTEXT_COLUMNS : sql``}
		FROM state_writes sw
		INNER JOIN blocks b ON b.height = sw.block_height
		${params.txContext ? TX_CONTEXT_JOIN : sql``}
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY sw.block_height ASC, sw.ordinal ASC
		LIMIT ${params.limit}
	`;
}

/** Canonical `state_writes` in `(block_height, ordinal)` order. */
export async function readStateWrites(
	params: ReadStateWritesParams,
): Promise<ReadStateWritesResult> {
	if (params.toHeight < params.fromHeight) {
		return { state_writes: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();
	const { rows } = await stateWritesQuery(params).execute(db);

	const stateWrites = rows.map((row): IndexStateWrite => {
		const blockHeight = Number(row.block_height);
		const ordinal = Number(row.ordinal);
		return {
			cursor: encodeIndexCursor({
				block_height: blockHeight,
				event_index: ordinal,
			}),
			block_height: blockHeight,
			ordinal,
			tx_index: row.tx_index === null ? null : Number(row.tx_index),
			key: row.key,
			value_hex: row.value_hex,
			...(params.txContext
				? {
						tx_id: row.tx_id ?? null,
						tx_sender: row.tx_sender ?? null,
						tx_type: row.tx_type ?? null,
						tx_status: row.tx_status ?? null,
						tx_contract_id: row.tx_contract_id ?? null,
						tx_function_name: row.tx_function_name ?? null,
					}
				: {}),
		};
	});
	return {
		state_writes: stateWrites,
		next_cursor: stateWrites.at(-1)?.cursor ?? null,
	};
}

/**
 * One canonical block's writes, whole and in ordinal order: what
 * `/v1/proofs/writes/{height}` serves for naming a block's diff. Empty when
 * the block is not canonical or this node never delivered its writes.
 */
export async function readBlockStateWrites(
	height: number,
	db: Kysely<Database> = getSourceDb(),
): Promise<Omit<IndexStateWrite, "cursor" | "block_height">[]> {
	const { rows } = await sql<StateWriteRow>`
		SELECT sw.ordinal, sw.tx_index, sw.key, sw.value_hex
		FROM state_writes sw
		INNER JOIN blocks b ON b.height = sw.block_height
		WHERE sw.block_height = ${height} AND b.canonical = true
		ORDER BY sw.ordinal ASC
	`.execute(db);
	return rows.map((row) => ({
		ordinal: Number(row.ordinal),
		tx_index: row.tx_index === null ? null : Number(row.tx_index),
		key: row.key,
		value_hex: row.value_hex,
	}));
}

/** `contract_id` and `tx_context`, validated. */
export function parseStateWritesFilters(query: URLSearchParams): {
	contractId?: string;
	txContext: boolean;
} {
	const contractId = query.get("contract_id") ?? undefined;
	if (contractId !== undefined && !CONTRACT_ID.test(contractId)) {
		throw new ValidationError(
			"contract_id must be one contract principal, <address>.<contract-name>",
		);
	}
	const raw = query.get("tx_context");
	if (raw !== null && raw !== "true" && raw !== "false") {
		throw new ValidationError("tx_context must be true or false");
	}
	return { contractId, txContext: raw === "true" };
}

/**
 * Fold `block_height=H` into the shared window params: `from_height=H&
 * to_height=H`, or `to_height=H` under a cursor that must sit at H. Every
 * downstream parse (window, cache plan) then sees one shape.
 */
export function resolveStateWritesQuery(
	query: URLSearchParams,
): URLSearchParams {
	const raw = query.get("block_height");
	if (raw === null) return query;
	const height = parseNonNegativeInteger(raw, "block_height");
	if (query.has("from_height") || query.has("to_height")) {
		throw new ValidationError(
			"block_height and from_height/to_height are mutually exclusive",
		);
	}
	const resolved = new URLSearchParams(query);
	resolved.delete("block_height");
	resolved.set("to_height", String(height));
	const cursor = query.get("cursor") ?? query.get("from_cursor");
	if (cursor === null) {
		resolved.set("from_height", String(height));
	} else if (parseCursor(cursor).block_height !== height) {
		throw new ValidationError("cursor must sit at block_height");
	}
	return resolved;
}

export async function getStateWritesResponse(opts: {
	/** Already through `resolveStateWritesQuery`. */
	query: URLSearchParams;
	tip: IndexTip;
	readStateWrites?: StateWritesReader;
	readReorgs?: StreamsReorgsReader;
}): Promise<StateWritesResponse> {
	const filters = parseStateWritesFilters(opts.query);
	// Writes land with the block: no decoder, so the source tip bounds them.
	const tip = indexSourceWindowTip(opts.tip);
	const base = parseIndexBaseQuery(opts.query, tip);
	// Ordinals are a second clock: overlap reorgs by height, never by ordinal.
	const reorgOpts = { overlap: "height" } as const;

	if (base.cursorPastTip) {
		return {
			state_writes: [],
			next_cursor: base.cursorRaw ?? null,
			tip,
			reorgs: base.cursor
				? await readReorgsForEvents([base.cursor], opts.readReorgs, reorgOpts)
				: [],
		};
	}

	const read = opts.readStateWrites ?? readStateWrites;
	const result = await read({
		after: base.cursor,
		fromHeight: base.fromHeight,
		toHeight: base.toHeight,
		limit: base.limit,
		...filters,
	});

	let span: IndexCursorInput[] = result.state_writes.map((row) => ({
		block_height: row.block_height,
		event_index: row.ordinal,
	}));
	// A resumed feed must report a rollback of the consumer's checkpoint even
	// when the page is empty or starts at a later height.
	if (base.cursor) {
		span = [
			base.cursor,
			span.at(-1) ?? {
				block_height: Math.max(base.cursor.block_height, base.toHeight),
				event_index: 0,
			},
		];
	}

	return {
		state_writes: result.state_writes,
		next_cursor: result.next_cursor,
		tip,
		reorgs: await readReorgsForEvents(span, opts.readReorgs, reorgOpts),
	};
}
