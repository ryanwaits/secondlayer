import {
	blockEndCursor,
	decodeStreamsCursor,
	encodeStreamsCursor,
} from "@secondlayer/shared";
import { ValidationError } from "./errors.ts";

/**
 * Helpers for Streams cursors. A cursor is the opaque `<block>:<index>` string
 * that marks a position in the event stream; treat the format as an
 * implementation detail and go through these helpers instead of string-building
 * it at call sites. Encode/decode and the rewind sentinel come from the
 * canonical codec in `@secondlayer/shared` so the SDK cannot accept a spelling
 * the server would 400, or rewind to a different foot than Index/Streams.
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
	 * Encoded as `blockEndCursor(height - 1)` rather than the seemingly-natural
	 * `${height}:0` — that earlier form was an off-by-one: being exclusive, it
	 * skipped `(height, 0)`, silently dropping the fork block's first row on
	 * every reorg. The sentinel is int4 max (the `event_index`/`tx_index` column
	 * type), larger than any real index, so nothing at `height - 1` survives the
	 * keyset and the next returned row is exactly `(height, 0)`.
	 */
	atHeight(height: number): string {
		// Genesis can't reorg; degenerate-guard so `height - 1` never goes negative
		// (the cursor parsers reject negative components).
		if (height <= 0) {
			return encodeStreamsCursor({ block_height: 0, event_index: 0 });
		}
		return encodeStreamsCursor(blockEndCursor(height - 1));
	},

	/** Parse a `<block>:<index>` cursor. Throws `ValidationError` if malformed. */
	parse(cursor: string): { blockHeight: number; eventIndex: number } {
		try {
			const decoded = decodeStreamsCursor(cursor);
			return {
				blockHeight: decoded.block_height,
				eventIndex: decoded.event_index,
			};
		} catch {
			throw new ValidationError(
				`Invalid stream cursor "${cursor}"; expected "<block>:<index>" (e.g. "951475:3").`,
				400,
			);
		}
	},
};
