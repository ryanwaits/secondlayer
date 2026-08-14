/**
 * Decoder clock — pair Streams cursor order with per-block receipts.
 *
 * A filtered firehose can jump from `100:5` to `105:0` and never mention
 * 101–104. Coverage still needs a receipt for every canonical height,
 * including no-match blocks. This library is that seam: cursors stay
 * monotonic, receipts stay one-per-height, empty blocks still ack.
 *
 * Only fully closed blocks in `(from_cursor, to_cursor]` emit receipts.
 * Mid-block resumes wait until the cursor is past the block.
 */

import { createHash } from "node:crypto";
import {
	type StreamsCursor,
	blockEndCursor,
	compareStreamsCursor,
	decodeStreamsCursor,
	encodeStreamsCursor,
	isEmptyRangeCursor,
} from "../streams-cursor.ts";

export type CanonicalBlock = {
	height: number;
	hash: string;
};

export type DecoderClockEvent = {
	cursor: string;
	block_hash: string;
	matched: boolean;
};

export type DecoderClockInput = {
	start_height: number;
	/** Exclusive. Null = before `start_height`. */
	from_cursor: string | null;
	/** Exclusive high-water after this batch. */
	to_cursor: string;
	blocks: readonly CanonicalBlock[];
	events: readonly DecoderClockEvent[];
};

export type DecoderClockReceipt = {
	height: number;
	hash: string;
	input_count: number;
	input_cursors: string[];
	input_digest: string;
	through_cursor: string;
	no_match: boolean;
};

export type DecoderClockResult =
	| { ok: true; receipts: DecoderClockReceipt[]; through_cursor: string }
	| { ok: false; reason: string; receipts: DecoderClockReceipt[] };

export function inputDigest(cursors: readonly string[]): string {
	if (cursors.length === 0) {
		return createHash("sha256").update("no-match\n").digest("hex");
	}
	const hash = createHash("sha256");
	for (const cursor of cursors) hash.update(`${cursor}\n`);
	return hash.digest("hex");
}

export function cursorIsAfterBlock(
	cursor: StreamsCursor,
	height: number,
): boolean {
	return compareStreamsCursor(cursor, blockEndCursor(height)) >= 0;
}

/** True when `from` is strictly before the first event that can live in `height`. */
export function cursorIsBeforeBlock(
	cursor: StreamsCursor,
	height: number,
): boolean {
	return cursor.block_height < height;
}

function parseCursor(
	value: string,
	label: string,
): { ok: true; cursor: StreamsCursor } | { ok: false; reason: string } {
	try {
		return { ok: true, cursor: decodeStreamsCursor(value) };
	} catch {
		return { ok: false, reason: `${label} is not a valid streams cursor` };
	}
}

export function planDecoderReceipts(
	input: DecoderClockInput,
): DecoderClockResult {
	const to = parseCursor(input.to_cursor, "to_cursor");
	if (!to.ok) return { ok: false, reason: to.reason, receipts: [] };

	let from: StreamsCursor | null = null;
	if (input.from_cursor !== null) {
		const parsed = parseCursor(input.from_cursor, "from_cursor");
		if (!parsed.ok) return { ok: false, reason: parsed.reason, receipts: [] };
		from = parsed.cursor;
		if (compareStreamsCursor(from, to.cursor) >= 0) {
			return {
				ok: false,
				reason: "to_cursor must be after from_cursor",
				receipts: [],
			};
		}
	}

	// A mid-block from_cursor (100:2) or a closed one (100:SENTINEL) both
	// mean the next fully-visible block is 101. Receipts are whole blocks.
	const startFull = from === null ? input.start_height : from.block_height + 1;
	const lastFull = isEmptyRangeCursor(to.cursor)
		? to.cursor.block_height
		: to.cursor.block_height - 1;

	if (lastFull < startFull) {
		return { ok: true, receipts: [], through_cursor: input.to_cursor };
	}

	if (startFull < input.start_height) {
		return {
			ok: false,
			reason: `window starts at ${startFull}, below start_height ${input.start_height}`,
			receipts: [],
		};
	}

	const byHeight = new Map<number, CanonicalBlock>();
	let prevHeight: number | null = null;
	for (const block of input.blocks) {
		if (prevHeight !== null && block.height !== prevHeight + 1) {
			return {
				ok: false,
				reason: `blocks are not contiguous (${prevHeight} → ${block.height})`,
				receipts: [],
			};
		}
		if (byHeight.has(block.height)) {
			return {
				ok: false,
				reason: `duplicate canonical height ${block.height}`,
				receipts: [],
			};
		}
		byHeight.set(block.height, block);
		prevHeight = block.height;
	}

	for (let height = startFull; height <= lastFull; height++) {
		if (!byHeight.has(height)) {
			return {
				ok: false,
				reason: `missing canonical block ${height}`,
				receipts: [],
			};
		}
	}

	const decoded: {
		cursor: StreamsCursor;
		encoded: string;
		block_hash: string;
		matched: boolean;
	}[] = [];
	let previous: StreamsCursor | null = from;
	for (const event of input.events) {
		const parsed = parseCursor(event.cursor, "event.cursor");
		if (!parsed.ok) return { ok: false, reason: parsed.reason, receipts: [] };
		if (previous && compareStreamsCursor(parsed.cursor, previous) <= 0) {
			return {
				ok: false,
				reason: `event cursor ${event.cursor} is not after ${encodeStreamsCursor(previous)}`,
				receipts: [],
			};
		}
		if (compareStreamsCursor(parsed.cursor, to.cursor) >= 0) {
			return {
				ok: false,
				reason: `event cursor ${event.cursor} is not before to_cursor`,
				receipts: [],
			};
		}
		if (from && compareStreamsCursor(parsed.cursor, from) <= 0) {
			return {
				ok: false,
				reason: `event cursor ${event.cursor} is not after from_cursor`,
				receipts: [],
			};
		}
		const block = byHeight.get(parsed.cursor.block_height);
		if (!block) {
			return {
				ok: false,
				reason: `event ${event.cursor} has no canonical block`,
				receipts: [],
			};
		}
		if (block.hash !== event.block_hash) {
			return {
				ok: false,
				reason: `event ${event.cursor} hash ${event.block_hash} does not match canonical ${block.hash}`,
				receipts: [],
			};
		}
		decoded.push({
			cursor: parsed.cursor,
			encoded: event.cursor,
			block_hash: event.block_hash,
			matched: event.matched,
		});
		previous = parsed.cursor;
	}

	const receipts: DecoderClockReceipt[] = [];
	for (let height = startFull; height <= lastFull; height++) {
		const block = byHeight.get(height);
		if (!block) {
			return {
				ok: false,
				reason: `missing canonical block ${height}`,
				receipts,
			};
		}
		const inBlock = decoded.filter((e) => e.cursor.block_height === height);
		const matched = inBlock.filter((e) => e.matched);
		const last = inBlock[inBlock.length - 1];
		const through = last
			? last.encoded
			: encodeStreamsCursor(blockEndCursor(height));
		receipts.push({
			height,
			hash: block.hash,
			input_count: matched.length,
			input_cursors: matched.map((e) => e.encoded),
			input_digest: inputDigest(matched.map((e) => e.encoded)),
			through_cursor: through,
			no_match: matched.length === 0,
		});
	}

	return { ok: true, receipts, through_cursor: input.to_cursor };
}
