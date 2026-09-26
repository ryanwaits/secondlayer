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
 * for all 11 types off ONE cursor scan, and commits each PAGE's checkpoints +
 * decoded rows together in its own transaction.
 *
 * Commit granularity is per-page, not per-cycle: after decoder downtime (a
 * deploy, a crash, `reset-checkpoints`, a newly-added decoder starting from
 * an old checkpoint) the gap between the lowest checkpoint and the tip can
 * be a large backlog, and the decoder container is resource-capped.
 * Accumulating every page of a backlog in memory before one giant commit
 * would hold millions of rows and one huge transaction. Instead each FULL
 * page (== `limit` rows) commits on its own, checkpointed at that page's own
 * boundary — mid-block is a fine checkpoint (`committedHeight()` already
 * treats `H:n` as "H-1 done, H in flight", the same as the old HTTP path).
 * Only a SHORT page (proof the scan reached `toHeight` with nothing left)
 * commits the end-of-block sentinel. So memory is bounded by `limit` and the
 * steady state — one short page per block — still costs one commit.
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

/** One reader call's page limit. Real per-block deltas are tiny; this also
 *  bounds how many rows one commit ever holds in memory — a page shorter
 *  than this is the proof a block's classic events are fully accounted for. */
export const DEFAULT_CLASSIC_BATCH_LIMIT = 1000;

/** Safety valve on how many pages one cycle may read (each with its own
 *  commit) before returning and letting the caller re-enter — bounds how
 *  long one cycle runs before the next liveness bump / wake check, instead
 *  of one call synchronously draining an entire backlog. */
export const DEFAULT_MAX_PAGES_PER_CYCLE = 25;

/** Test seam: swaps the real multi-decoder commit for a spy so a test can
 *  observe each page's commit (call count, row counts) without a different
 *  code path from production. Defaults to `commitClassicDecoderBatch`. */
export type ClassicDecoderCommitFn = (
	entries: readonly GenericDecoderBatchEntry[],
	opts?: { db?: Kysely<Database> },
) => Promise<void>;

export type ClassicDecodeCycleResult = {
	/** Rows actually decoded and written this cycle (excludes faulted events). */
	decoded: number;
	/** Per-decoder rows written this cycle. */
	decodedByDecoder: Record<DecoderName, number>;
	/** Raw classic events scanned this cycle, across every page. */
	scanned: number;
	/** Commits made this cycle (0 when idle). */
	pagesCommitted: number;
	/** False when every classic decoder was already at/past the source tip —
	 *  the caller should back off instead of looping immediately. */
	progressed: boolean;
	/** Every decoder's checkpoint cursor after this cycle (unchanged ones too). */
	checkpoints: Record<DecoderName, string | null>;
	/** First not-yet-committed height this cycle scanned from — the lowest
	 *  classic checkpoint plus one. Null when every checkpoint is unset (never
	 *  committed, scan starts at genesis) is represented as 0, not null; null
	 *  here means the cycle never reached a tip read at all (no canonical
	 *  block exists yet). Instrumentation for tracing decode-cycle latency. */
	fromHeight: number | null;
	/** Source-tip height this cycle bounded itself to. Null only when no
	 *  canonical block exists yet. */
	toHeight: number | null;
	/** Wall time spent inside `readCanonicalStreamsEvents`, summed across
	 *  every page this cycle read. */
	readMs: number;
	/** Wall time spent inside `commit`, summed across every page this cycle
	 *  committed. */
	commitMs: number;
	/** Wall time for the whole cycle, start to return. */
	totalMs: number;
};

function emptyCheckpointResult(
	checkpoints: Record<DecoderName, string | null>,
	opts: {
		fromHeight: number | null;
		toHeight: number | null;
		totalMs: number;
	},
): ClassicDecodeCycleResult {
	const decodedByDecoder = {} as Record<DecoderName, number>;
	for (const name of DECODER_NAMES) decodedByDecoder[name] = 0;
	return {
		decoded: 0,
		decodedByDecoder,
		scanned: 0,
		pagesCommitted: 0,
		progressed: false,
		checkpoints,
		fromHeight: opts.fromHeight,
		toHeight: opts.toHeight,
		readMs: 0,
		commitMs: 0,
		totalMs: opts.totalMs,
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
 * One in-process read+decode+commit cycle for all 11 classic decoders. May
 * issue several page reads (each with its own commit) up to
 * `maxPagesPerCycle` before returning — see the module doc for why commits
 * are per-page, not per-cycle.
 *
 * Reads the SOURCE DB's canonical tip BEFORE reading events, never after —
 * so `toHeight` can only be a height whose block (and every one of its
 * events) was already durably committed when the tip read saw it:
 * `persistBlock` (`../persist.ts`) inserts a block's row and all its events
 * in one transaction, so a `blocks` row visible to this read is a block
 * whose events are visible too. Each page's events read then filters
 * strictly by `block_height <= toHeight`, so even if the real chain tip
 * advances between the two reads, this cycle can never claim a height it
 * didn't actually scan — the tip snapshot only ever lags the true tip, never
 * leads it.
 */
export async function runClassicDecodeCycle(opts?: {
	db?: Kysely<Database>;
	limit?: number;
	maxPagesPerCycle?: number;
	commit?: ClassicDecoderCommitFn;
}): Promise<ClassicDecodeCycleResult> {
	const cycleStart = Date.now();
	const db = opts?.db ?? getSourceDb();
	const limit = opts?.limit ?? DEFAULT_CLASSIC_BATCH_LIMIT;
	const maxPages = opts?.maxPagesPerCycle ?? DEFAULT_MAX_PAGES_PER_CYCLE;
	const commit = opts?.commit ?? commitClassicDecoderBatch;

	const startCheckpoints = {} as Record<DecoderName, string | null>;
	for (const name of DECODER_NAMES) {
		startCheckpoints[name] = await readDecoderCheckpoint({
			db,
			decoderName: name,
		});
	}

	const lowestCursor = pickLowestCursor(Object.values(startCheckpoints));
	const lowestCommittedHeight = committedHeight(lowestCursor);
	const fromHeight =
		lowestCommittedHeight === null ? 0 : lowestCommittedHeight + 1;

	const tip = await getCurrentCanonicalTip(db);
	if (!tip) {
		return emptyCheckpointResult(startCheckpoints, {
			fromHeight: null,
			toHeight: null,
			totalMs: Date.now() - cycleStart,
		});
	}
	const toHeight = tip.block_height;

	if (lowestCommittedHeight !== null && lowestCommittedHeight >= toHeight) {
		// Every classic decoder already committed through the source tip.
		return emptyCheckpointResult(startCheckpoints, {
			fromHeight,
			toHeight,
			totalMs: Date.now() - cycleStart,
		});
	}

	// Mutable running state, updated after each page's successful commit —
	// the NEXT page's `startedFrom` (so a rewind between two page commits is
	// caught independently per page) and the skip-if-already-committed check
	// for a type whose own checkpoint is ahead of the shared scan's start.
	const currentCheckpoints = { ...startCheckpoints };
	const decodedByDecoder = {} as Record<DecoderName, number>;
	for (const name of DECODER_NAMES) decodedByDecoder[name] = 0;

	let after = lowestCursor ? decodeStreamsCursor(lowestCursor) : undefined;
	let scanned = 0;
	let pages = 0;
	let readMs = 0;
	let commitMs = 0;

	while (pages < maxPages) {
		pages++;
		const readStart = Date.now();
		const page = await readCanonicalStreamsEvents({
			db,
			after,
			toHeight,
			types: CLASSIC_TYPES,
			limit,
		});
		readMs += Date.now() - readStart;
		const events = page.events as StreamsEvent[];
		scanned += events.length;

		// Per-page accumulators — reset every iteration so memory is bounded
		// by one page's worth of rows, never the whole backlog.
		const rowsByDecoder = {} as Record<DecoderName, DecodedEventRow[]>;
		const clockEventsByDecoder = {} as Record<DecoderName, GenericClockEvent[]>;
		const faultsByDecoder = {} as Record<
			DecoderName,
			{ cursor: string; class: GenericDecodeFault; error: string }[]
		>;
		/** Last cursor of THIS type seen in THIS page — null means no match
		 *  this page (distinct from "unchanged", handled below). */
		const lastMatchThisPage = {} as Record<DecoderName, string | null>;
		for (const name of DECODER_NAMES) {
			rowsByDecoder[name] = [];
			clockEventsByDecoder[name] = [];
			faultsByDecoder[name] = [];
			lastMatchThisPage[name] = null;
		}
		const blockTimes: { block_height: number; ts: string }[] = [];

		for (const event of events) {
			blockTimes.push({ block_height: event.block_height, ts: event.ts });
			const decoderName = CLASSIC_DECODER_NAME_BY_TYPE[event.event_type];
			if (!decoderName) continue;
			const checkpoint = currentCheckpoints[decoderName];
			if (
				checkpoint !== null &&
				compareStreamsCursor(
					decodeStreamsCursor(event.cursor),
					decodeStreamsCursor(checkpoint),
				) <= 0
			) {
				// Already committed: this type's own checkpoint is ahead of the
				// shared scan's start (a different type was the laggard).
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
			lastMatchThisPage[decoderName] = event.cursor;
		}

		// A page shorter than requested proves the scan already reached
		// `toHeight` empty-handed (the reader's own contract — see
		// `shortPageCheckpointCursor` in generic-commit.ts for the same proof
		// on the single-decoder path): every classic type is complete through
		// `toHeight`, whether or not it had a match in this page. A full page
		// only proves the scanned SUB-range [after, this page's last cursor] —
		// a type with no match in it is complete through that sub-range (the
		// scan covers every classic type, so its absence is proof), but a type
		// WITH a match can only be trusted through its own last matched cursor.
		const shortPage = events.length < limit;
		const pageBoundary = page.next_cursor;
		const pageCheckpoints = {} as Record<DecoderName, string | null>;
		for (const name of DECODER_NAMES) {
			pageCheckpoints[name] = shortPage
				? encodeStreamsCursor(blockEndCursor(toHeight))
				: (lastMatchThisPage[name] ?? pageBoundary ?? currentCheckpoints[name]);
		}

		const entries: GenericDecoderBatchEntry[] = DECODER_NAMES.map((name) => ({
			decoderName: name,
			checkpointCursor: pageCheckpoints[name],
			rows: rowsByDecoder[name],
			receipts: planGenericDecoderReceipts(clockEventsByDecoder[name]),
			failure: failureFromFaults(faultsByDecoder[name]),
			startedFrom: currentCheckpoints[name],
		}));

		// A rewind detected here (a concurrent reorg moved a checkpoint between
		// this page's read and its commit) aborts ONLY this page's transaction —
		// any earlier page in this cycle already committed and stays committed.
		// The error propagates to the caller, which resumes on the NEXT cycle
		// by re-reading checkpoints (now reflecting the rewind) from scratch.
		const commitStart = Date.now();
		await commit(entries, { db });
		commitMs += Date.now() - commitStart;

		for (const name of DECODER_NAMES) {
			decodedByDecoder[name] += rowsByDecoder[name].length;
			const advance = checkpointAdvance(
				currentCheckpoints[name],
				pageCheckpoints[name],
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
			currentCheckpoints[name] = pageCheckpoints[name];
		}

		if (shortPage || !pageBoundary) break;
		after = decodeStreamsCursor(pageBoundary);
	}

	const decoded = DECODER_NAMES.reduce(
		(total, name) => total + decodedByDecoder[name],
		0,
	);

	return {
		decoded,
		decodedByDecoder,
		scanned,
		pagesCommitted: pages,
		progressed: true,
		checkpoints: currentCheckpoints,
		fromHeight,
		toHeight,
		readMs,
		commitMs,
		totalMs: Date.now() - cycleStart,
	};
}

/** The slice of `WakeBus` the classic-decoder loop's wait step needs — a
 *  plain object literal satisfies this in tests, no real LISTEN required. */
export type ClassicDecodeWakeBus = {
	wait: () => Promise<void>;
	generation: () => number;
};

export type ClassicDecodeWaitTrigger = "wake" | "timer";

/**
 * Decide how the classic-decoder loop resumes after an idle cycle (nothing
 * left to decode through the source tip it saw). A NOTIFY can land on
 * `indexer:new_block` while the PREVIOUS `runClassicDecodeCycle` call was
 * still running — nobody was an active `wait()`er at that moment, so
 * `createWakeBus`'s resolve fan-out (`packages/shared/src/queue/listener.ts`)
 * drops it on the floor. Without this check, the loop would then register a
 * brand new `wait()` that only resolves on a FUTURE notify, so that block's
 * decode waits out the empty-poll backoff (or the next block entirely)
 * instead of running right away. Same generation-check pattern as the Index
 * API long-poll fix (`packages/api/src/index/wait.ts`).
 *
 * `generationAtCycleStart` must be read (via `wakeBus.generation()`) right
 * before the cycle that just finished was started — if the bus's generation
 * has since moved past it, at least one commit happened while busy, and this
 * returns "wake" immediately instead of racing a fresh wait against the
 * backoff timer.
 */
export async function waitForNextClassicDecodeCycle(opts: {
	wakeBus: ClassicDecodeWakeBus | null;
	generationAtCycleStart: number;
	emptyBackoffMs: number;
	sleep: (ms: number) => Promise<void>;
}): Promise<ClassicDecodeWaitTrigger> {
	const { wakeBus, generationAtCycleStart, emptyBackoffMs, sleep } = opts;
	if (!wakeBus) {
		await sleep(emptyBackoffMs);
		return "timer";
	}
	if (wakeBus.generation() !== generationAtCycleStart) {
		return "wake";
	}
	return Promise.race([
		sleep(emptyBackoffMs).then(() => "timer" as const),
		wakeBus
			.wait()
			.then(() => "wake" as const)
			.catch(() => new Promise<never>(() => {})),
	]);
}
