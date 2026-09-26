/**
 * In-process classic decoder loop (plan-066).
 *
 * The 11 classic decoders (ft/nft/stx transfer, mint, burn, lock, print) used
 * to be 11 separate HTTP Streams consumers. Every one of those types is a
 * pure function of the row (`@secondlayer/shared/streams-rows`) and the
 * dense cursor ordinal Streams computes — no RPC, no table reads beyond
 * `events`/`transactions`/`blocks`, which the decoder process already has
 * direct DB access to in every topology that runs it. This reads the SAME
 * reader Streams' own route calls (`readCanonicalStreamsEvents`,
 * `../streams-events.ts` — the backfill-from-firehose precedent) in-process,
 * for all 11 types off ONE cursor scan, and commits their checkpoints +
 * decoded rows together in ONE transaction.
 */

import {
	blockEndCursor,
	committedHeight,
	compareStreamsCursor,
	decodeStreamsCursor,
	encodeStreamsCursor,
} from "@secondlayer/shared";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import {
	type DecodedEventRow,
	type StreamsEvent,
	type StreamsEventType,
	decodeFtBurn,
	decodeFtMint,
	decodeFtTransfer,
	decodeNftBurn,
	decodeNftMint,
	decodeNftTransfer,
	decodePrint,
	decodeStxBurn,
	decodeStxLock,
	decodeStxMint,
	decodeStxTransfer,
} from "@secondlayer/shared/streams-rows";
import type { Kysely } from "kysely";
import { readCanonicalStreamsEvents } from "../streams-events.ts";
import { getCurrentCanonicalTip } from "../streams-tip.ts";
import {
	type GenericClockEvent,
	type GenericDecodeFault,
	type GenericDecoderBatchEntry,
	checkpointAdvance,
	classifyGenericDecodeFault,
	commitClassicDecoderBatch,
	failureFromFaults,
	planGenericDecoderReceipts,
} from "./generic-commit.ts";
import {
	DECODER_EVENT_TYPES,
	DECODER_NAMES,
	type DecoderName,
	readDecoderCheckpoint,
} from "./storage.ts";

/** The 11 classic types, in `DECODER_NAMES` order — the fixed order every
 *  multi-decoder commit and `handleDecodedEventsReorg` rewind must agree on
 *  so checkpoint-row locks are always taken in the same sequence. */
export const CLASSIC_TYPES: readonly StreamsEventType[] = DECODER_NAMES.map(
	(name) => DECODER_EVENT_TYPES[name] as StreamsEventType,
);

const CLASSIC_DECODE_BY_TYPE: Record<
	StreamsEventType,
	(event: StreamsEvent) => DecodedEventRow
> = {
	ft_transfer: decodeFtTransfer,
	ft_mint: decodeFtMint,
	ft_burn: decodeFtBurn,
	nft_transfer: decodeNftTransfer,
	nft_mint: decodeNftMint,
	nft_burn: decodeNftBurn,
	stx_transfer: decodeStxTransfer,
	stx_mint: decodeStxMint,
	stx_burn: decodeStxBurn,
	stx_lock: decodeStxLock,
	print: decodePrint,
};

const CLASSIC_DECODER_NAME_BY_TYPE: Partial<
	Record<StreamsEventType, DecoderName>
> = Object.fromEntries(
	DECODER_NAMES.map((name) => [DECODER_EVENT_TYPES[name], name]),
);

/** One reader call's page limit. Real per-block deltas are tiny; this only
 *  bounds how much one page reads before the loop checks whether it reached
 *  `toHeight` — a full page (== limit) means there may be more, and a wider
 *  block than this keeps paging within the same cycle (2.4). */
export const DEFAULT_CLASSIC_BATCH_LIMIT = 1000;

/** Safety valve on how many pages one cycle may read before it commits
 *  whatever it proved and lets the next wake continue — bounds memory
 *  against a pathological backlog instead of holding an ever-growing batch. */
export const DEFAULT_MAX_PAGES_PER_CYCLE = 25;

export type ClassicDecodeCycleResult = {
	/** Rows actually decoded and written this cycle (excludes faulted events). */
	decoded: number;
	/** Per-decoder rows written this cycle. */
	decodedByDecoder: Record<DecoderName, number>;
	/** Raw classic events scanned this cycle, across every page. */
	scanned: number;
	/** False when every classic decoder was already at/past the source tip —
	 *  the caller should back off instead of looping immediately. */
	progressed: boolean;
	/** Every decoder's checkpoint cursor after this cycle (unchanged ones too). */
	checkpoints: Record<DecoderName, string | null>;
};

function emptyCheckpointResult(
	checkpoints: Record<DecoderName, string | null>,
): ClassicDecodeCycleResult {
	const decodedByDecoder = {} as Record<DecoderName, number>;
	for (const name of DECODER_NAMES) decodedByDecoder[name] = 0;
	return {
		decoded: 0,
		decodedByDecoder,
		scanned: 0,
		progressed: false,
		checkpoints,
	};
}

/** Lowest of a set of checkpoint cursors, `null` (genesis) if any is unset —
 *  a never-committed decoder must scan from height 0, which is earlier than
 *  every real cursor. */
function pickLowestCursor(cursors: readonly (string | null)[]): string | null {
	let lowest: string | undefined;
	for (const cursor of cursors) {
		if (cursor === null) return null;
		if (
			lowest === undefined ||
			compareStreamsCursor(
				decodeStreamsCursor(cursor),
				decodeStreamsCursor(lowest),
			) < 0
		) {
			lowest = cursor;
		}
	}
	return lowest ?? null;
}

/**
 * One in-process read+decode+commit cycle for all 11 classic decoders.
 *
 * Reads the SOURCE DB's canonical tip BEFORE reading events, never after —
 * so `toHeight` can only be a height whose block (and every one of its
 * events) was already durably committed when the tip read saw it:
 * `persistBlock` (`../persist.ts`) inserts a block's row and all its events
 * in one transaction, so a `blocks` row visible to this read is a block
 * whose events are visible too. The events read then filters strictly by
 * `block_height <= toHeight`, so even if the real chain tip advances between
 * the two reads, this cycle can never claim a height it didn't actually
 * scan — the tip snapshot only ever lags the true tip, never leads it.
 */
export async function runClassicDecodeCycle(opts?: {
	db?: Kysely<Database>;
	limit?: number;
	maxPagesPerCycle?: number;
}): Promise<ClassicDecodeCycleResult> {
	const db = opts?.db ?? getSourceDb();
	const limit = opts?.limit ?? DEFAULT_CLASSIC_BATCH_LIMIT;
	const maxPages = opts?.maxPagesPerCycle ?? DEFAULT_MAX_PAGES_PER_CYCLE;

	const startCheckpoints = {} as Record<DecoderName, string | null>;
	for (const name of DECODER_NAMES) {
		startCheckpoints[name] = await readDecoderCheckpoint({
			db,
			decoderName: name,
		});
	}

	const lowestCursor = pickLowestCursor(Object.values(startCheckpoints));
	const lowestCommittedHeight = committedHeight(lowestCursor);

	const tip = await getCurrentCanonicalTip(db);
	if (!tip) return emptyCheckpointResult(startCheckpoints);
	const toHeight = tip.block_height;

	if (lowestCommittedHeight !== null && lowestCommittedHeight >= toHeight) {
		// Every classic decoder already committed through the source tip.
		return emptyCheckpointResult(startCheckpoints);
	}

	const rowsByDecoder = {} as Record<DecoderName, DecodedEventRow[]>;
	const clockEventsByDecoder = {} as Record<DecoderName, GenericClockEvent[]>;
	const faultsByDecoder = {} as Record<
		DecoderName,
		{ cursor: string; class: GenericDecodeFault; error: string }[]
	>;
	const lastCursorByDecoder = { ...startCheckpoints };
	for (const name of DECODER_NAMES) {
		rowsByDecoder[name] = [];
		clockEventsByDecoder[name] = [];
		faultsByDecoder[name] = [];
	}
	// Any scanned event's block_height/ts is enough to look up a newly
	// committed height's block time (`checkpointAdvance`) — every decoder's
	// advance log can share this one list instead of tracking its own.
	const blockTimes: { block_height: number; ts: string }[] = [];

	let after = lowestCursor ? decodeStreamsCursor(lowestCursor) : undefined;
	let scanned = 0;
	let pages = 0;
	let reachedEnd = false;

	while (true) {
		pages++;
		const page = await readCanonicalStreamsEvents({
			db,
			after,
			toHeight,
			types: CLASSIC_TYPES,
			limit,
		});
		const events = page.events as StreamsEvent[];
		scanned += events.length;

		for (const event of events) {
			blockTimes.push({ block_height: event.block_height, ts: event.ts });
			const decoderName = CLASSIC_DECODER_NAME_BY_TYPE[event.event_type];
			if (!decoderName) continue;
			const checkpoint = startCheckpoints[decoderName];
			if (
				checkpoint !== null &&
				compareStreamsCursor(
					decodeStreamsCursor(event.cursor),
					decodeStreamsCursor(checkpoint),
				) <= 0
			) {
				// Already committed by an earlier cycle: this type's own checkpoint
				// is ahead of the shared scan's start (a different type was the
				// laggard whose cursor set `after`).
				continue;
			}
			try {
				const row = CLASSIC_DECODE_BY_TYPE[event.event_type](event);
				rowsByDecoder[decoderName].push(row);
				clockEventsByDecoder[decoderName].push({
					cursor: event.cursor,
					block_height: event.block_height,
					block_hash: event.block_hash,
					matched: true,
				});
			} catch (error) {
				const fault = classifyGenericDecodeFault(error);
				logger.warn("decoder.decode_skipped", {
					decoder: decoderName,
					cursor: event.cursor,
					tx_id: event.tx_id,
					fault,
					error: String(error),
				});
				clockEventsByDecoder[decoderName].push({
					cursor: event.cursor,
					block_height: event.block_height,
					block_hash: event.block_hash,
					matched: false,
				});
				faultsByDecoder[decoderName].push({
					cursor: event.cursor,
					class: fault,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			lastCursorByDecoder[decoderName] = event.cursor;
		}

		const truncated = events.length >= limit;
		if (!truncated) {
			reachedEnd = true;
			break;
		}
		if (pages >= maxPages || !page.next_cursor) break;
		after = decodeStreamsCursor(page.next_cursor);
	}

	const finalCheckpoints = {} as Record<DecoderName, string | null>;
	for (const name of DECODER_NAMES) {
		finalCheckpoints[name] = reachedEnd
			? encodeStreamsCursor(blockEndCursor(toHeight))
			: lastCursorByDecoder[name];
	}

	const entries: GenericDecoderBatchEntry[] = DECODER_NAMES.map((name) => ({
		decoderName: name,
		checkpointCursor: finalCheckpoints[name],
		rows: rowsByDecoder[name],
		receipts: planGenericDecoderReceipts(clockEventsByDecoder[name]),
		failure: failureFromFaults(faultsByDecoder[name]),
		startedFrom: startCheckpoints[name],
	}));

	await commitClassicDecoderBatch(entries, { db });

	const decodedByDecoder = {} as Record<DecoderName, number>;
	for (const name of DECODER_NAMES) {
		decodedByDecoder[name] = rowsByDecoder[name].length;
		const advance = checkpointAdvance(
			startCheckpoints[name],
			finalCheckpoints[name],
			blockTimes,
		);
		if (advance) {
			logger.info("decoder.checkpoint_advanced", {
				event: "decoder_checkpoint_advanced",
				decoder: name,
				height: advance.height,
				block_time: advance.blockTime,
				advanced_at: new Date().toISOString(),
			});
		}
	}

	const decoded = DECODER_NAMES.reduce(
		(total, name) => total + decodedByDecoder[name],
		0,
	);

	return {
		decoded,
		decodedByDecoder,
		scanned,
		progressed: true,
		checkpoints: finalCheckpoints,
	};
}
