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
 * primary key; no other index.
 */
export const STATE_WRITES_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"block_height",
] as const;

export type IndexStateWrite = {
	cursor: string;
	block_height: number;
	ordinal: number;
	/** Null for block-level writes. */
	tx_index: number | null;
	key: string;
	value_hex: string;
};

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
};

/** Canonical `state_writes` in `(block_height, ordinal)` order. */
export async function readStateWrites(
	params: ReadStateWritesParams,
): Promise<ReadStateWritesResult> {
	if (params.toHeight < params.fromHeight) {
		return { state_writes: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();
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

	const { rows } = await sql<StateWriteRow>`
		SELECT sw.block_height, sw.ordinal, sw.tx_index, sw.key, sw.value_hex
		FROM state_writes sw
		INNER JOIN blocks b ON b.height = sw.block_height
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY sw.block_height ASC, sw.ordinal ASC
		LIMIT ${params.limit}
	`.execute(db);

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
		};
	});
	return {
		state_writes: stateWrites,
		next_cursor: stateWrites.at(-1)?.cursor ?? null,
	};
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
