import { ValidationError } from "./errors.ts";

/**
 * Largest value the `event_index` / `tx_index` cursor component can take —
 * Postgres int4 max. Used as the foot-of-block sentinel in {@link Cursor.atHeight}
 * so a rewind cursor sorts just below `height:0`. Mirrors the same int4-max
 * sentinel the server uses for reorg height-range scans and empty-range advance.
 */
const REWIND_FOOT_INDEX_SENTINEL = 2_147_483_647;

/**
 * Helpers for Streams cursors. A cursor is the opaque `<block>:<index>` string
 * that marks a position in the event stream; treat the format as an
 * implementation detail and go through these helpers instead of string-building
 * it at call sites.
 */
export const Cursor = {
	/**
	 * Cursor at the foot of `height` — a position that sorts strictly below the
	 * first event of block `height` (`height:0`) and strictly above every event
	 * of block `height - 1`. Cursors are exclusive (`(bh,ei) > after`), so
	 * resuming from it re-reads the entire canonical run starting at `height:0`
	 * inclusive. This is the position to rewind to after a reorg whose fork point
	 * is `height`: the new canonical block at `height` carries a fresh first
	 * event at `(height, 0)` that the consumer MUST re-read.
	 *
	 * Encoded as `${height-1}:${SENTINEL}` rather than the seemingly-natural
	 * `${height}:0` — that earlier form was an off-by-one: being exclusive, it
	 * skipped `(height, 0)`, silently dropping the fork block's first row on
	 * every reorg. The sentinel is int4 max (the `event_index`/`tx_index` column
	 * type), larger than any real index, so nothing at `height - 1` survives the
	 * keyset and the next returned row is exactly `(height, 0)`.
	 */
	atHeight(height: number): string {
		// Genesis can't reorg; degenerate-guard so `height - 1` never goes negative
		// (the cursor parsers reject negative components).
		if (height <= 0) return "0:0";
		return `${height - 1}:${REWIND_FOOT_INDEX_SENTINEL}`;
	},

	/** Parse a `<block>:<index>` cursor. Throws `ValidationError` if malformed. */
	parse(cursor: string): { blockHeight: number; eventIndex: number } {
		const parts = cursor.split(":");
		const blockHeight = Number(parts[0]);
		const eventIndex = Number(parts[1]);
		if (
			parts.length !== 2 ||
			!Number.isInteger(blockHeight) ||
			!Number.isInteger(eventIndex)
		) {
			throw new ValidationError(
				`Invalid stream cursor "${cursor}"; expected "<block>:<index>" (e.g. "951475:3").`,
				400,
			);
		}
		return { blockHeight, eventIndex };
	},
};
