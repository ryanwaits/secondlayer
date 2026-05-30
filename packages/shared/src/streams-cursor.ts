/**
 * Canonical Streams cursor codec, shared by every product (Streams, Index,
 * Datasets, bulk). A cursor is `"<block_height>:<event_index>"` — an opaque,
 * monotonic resume token. One implementation so encode/decode and the
 * empty-range sentinel can never drift between products.
 *
 * NOTE: this codec IS the shared piece worth centralizing. A broader "shared
 * canonical reader" across the ~10 raw-event query sites (streams-events,
 * streams-bulk/query, api+indexer datasets/stx-transfers/query, l2/storage) was
 * deliberately NOT built: those sites split into three distinct query patterns
 * (raw-events-with-blocks-join, pre-computed dataset tables, burnchain) and
 * share only the row_number ordering *pattern*, not an identical reader. The
 * reorg-archive design (migration 0084) keeps the main tables canonical-only, so
 * each reader's `WHERE canonical` filter already needs no dedup logic. Forcing
 * one mega-reader was the wrong abstraction; this codec captures the only part
 * that actually drifts.
 */

export type StreamsCursor = {
	block_height: number;
	event_index: number;
};

/**
 * Event index used to advance a cursor past a fully-filtered range instead of
 * returning null. A filter that eliminates every event in a scanned range would
 * otherwise pin the consumer at the previous cursor and spin forever. Must fit
 * in Postgres int4 (the `stream_event_index` column type) — int4 max is plenty,
 * real blocks have far fewer than ~2.1B events.
 */
export const EMPTY_RANGE_EVENT_INDEX_SENTINEL = 2_147_483_647;

export function encodeStreamsCursor(cursor: StreamsCursor): string {
	return `${cursor.block_height}:${cursor.event_index}`;
}

export function decodeStreamsCursor(cursor: string): StreamsCursor {
	const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(cursor);
	if (!match) {
		throw new Error("Invalid Streams cursor");
	}

	const decoded = {
		block_height: Number(match[1]),
		event_index: Number(match[2]),
	};

	if (
		!Number.isSafeInteger(decoded.block_height) ||
		!Number.isSafeInteger(decoded.event_index)
	) {
		throw new Error("Invalid Streams cursor");
	}

	return decoded;
}
