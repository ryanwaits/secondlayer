import { ValidationError } from "./errors.ts";

/**
 * Helpers for Streams cursors. A cursor is the opaque `<block>:<index>` string
 * that marks a position in the event stream; treat the format as an
 * implementation detail and go through these helpers instead of string-building
 * it at call sites.
 */
export const Cursor = {
	/**
	 * Cursor at the foot of `height`. Resuming from it re-reads every event
	 * strictly above block `height` (cursors are exclusive), so this is the
	 * position to rewind to after a reorg whose fork point is `height`.
	 */
	atHeight(height: number): string {
		return `${height}:0`;
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
