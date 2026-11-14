/**
 * Decoder-stage commit — generic (STX/FT/NFT/print) and protocol
 * (sBTC/PoX/BNS) producers share the atomic decoder adapter here.
 */

import {
	blockEndCursor,
	committedHeight,
	encodeStreamsCursor,
} from "@secondlayer/shared";
import {
	type DecoderAdapterFailure,
	commitDecoderAdapter,
	commitDecoderAdapterBatch,
} from "@secondlayer/shared/coverage";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { DecodedEventRow } from "@secondlayer/shared/streams-rows";
import type { Kysely } from "kysely";
import { assertCheckpointUnmoved, writeDecodedEvents } from "./storage.ts";

export const GENERIC_DECODER_PRODUCER_VERSION = "v1";

/**
 * Skip the follow-up empty poll a decoder would otherwise need to reach the
 * end-of-block sentinel. `streams-events.ts` always delivers exactly
 * `requestedBatchSize` rows when its scan was cut off by the page limit, and
 * fewer than that only when the scan ran every candidate row in the range
 * dry before hitting the limit (`pageRows = rows.slice(0, limit)` — see
 * `readCanonicalStreamsEvents`). A page shorter than requested is therefore
 * proof the range through the server's scan ceiling is fully accounted for.
 *
 * That ceiling IS `envelope.tip.block_height` only at the internal Streams
 * tier (`STREAMS_INTERNAL_TIP_REORG_MARGIN_BLOCKS = 0`) that
 * every in-fleet decoder authenticates at — a public/account tier holds the
 * scan back by a reorg margin, so its short pages would under-claim. Callers
 * outside that tier must not use this.
 */
export function shortPageCheckpointCursor(opts: {
	eventCount: number;
	requestedBatchSize: number;
	tipHeight: number;
	/** `envelope.next_cursor` — used whenever the short-page proof doesn't apply. */
	fallback: string | null;
}): string | null {
	if (opts.eventCount === 0 || opts.eventCount >= opts.requestedBatchSize) {
		return opts.fallback;
	}
	return encodeStreamsCursor(blockEndCursor(opts.tipHeight));
}

export type GenericDecodeFault = "omission" | "version";

export function classifyGenericDecodeFault(error: unknown): GenericDecodeFault {
	const message = error instanceof Error ? error.message : String(error);
	if (/version|unsupported schema|unknown decoder/i.test(message)) {
		return "version";
	}
	return "omission";
}

export function failureFromFaults(
	faults: readonly {
		cursor: string;
		class: GenericDecodeFault;
		error: string;
	}[],
): DecoderAdapterFailure | null {
	const first = faults[0];
	if (!first) return null;
	const heights = faults
		.map((f) => Number(f.cursor.split(":")[0]))
		.filter((n) => Number.isSafeInteger(n));
	return {
		unit_kind: "block",
		class: first.class,
		retry_state: "open",
		from_height: heights.length > 0 ? Math.min(...heights) : null,
		to_height: heights.length > 0 ? Math.max(...heights) : null,
		error: first.error,
	};
}

export async function commitDecoderStageBatch(opts: {
	db?: Kysely<Database>;
	decoderName: string;
	checkpointCursor: string | null;
	failure?: DecoderAdapterFailure | null;
	writeOutput: (tx: Kysely<Database>) => Promise<void>;
	/** Rows `writeOutput` writes; stamps `last_output_at` when > 0. */
	outputCount: number;
	/** Cursor this consume believes is stored. Identity-checked FOR UPDATE
	 *  before output; a reorg rewind aborts so we do not stamp next_cursor. */
	startedFrom: string | null;
}): Promise<void> {
	const db = opts.db ?? getSourceDb();
	await commitDecoderAdapter(db, {
		stage_id: opts.decoderName,
		decoder_name: opts.decoderName,
		checkpoint_cursor: opts.checkpointCursor,
		failure: opts.failure ?? null,
		output_count: opts.outputCount,
		writeOutput: async (tx) => {
			await assertCheckpointUnmoved({
				db: tx as unknown as Kysely<Database>,
				decoderName: opts.decoderName,
				expected: opts.startedFrom,
			});
			await opts.writeOutput(tx as unknown as Kysely<Database>);
		},
	});
}

export async function commitGenericDecoderBatch(opts: {
	db?: Kysely<Database>;
	decoderName: string;
	checkpointCursor: string | null;
	rows: readonly DecodedEventRow[];
	failure?: DecoderAdapterFailure | null;
	startedFrom: string | null;
}): Promise<void> {
	await commitDecoderStageBatch({
		db: opts.db,
		decoderName: opts.decoderName,
		checkpointCursor: opts.checkpointCursor,
		failure: opts.failure,
		startedFrom: opts.startedFrom,
		outputCount: opts.rows.length,
		writeOutput: (tx) =>
			writeDecodedEvents(opts.rows, {
				db: tx as unknown as Kysely<Database>,
			}),
	});
}

/**
 * One entry of a multi-decoder batch commit — same shape
 * `commitGenericDecoderBatch` takes for a single decoder, grouped under one
 * decoder name so several types can land in ONE transaction.
 */
export type GenericDecoderBatchEntry = {
	decoderName: string;
	checkpointCursor: string | null;
	rows: readonly DecodedEventRow[];
	failure?: DecoderAdapterFailure | null;
	startedFrom: string | null;
};

/**
 * Commit several classic decoders' checkpoints + rows in ONE transaction —
 * the in-process loop reads all 11 classic types off a single cursor scan,
 * so their commits must be atomic together: a crash partway
 * through must never leave one type's checkpoint ahead of another's rows.
 *
 * Each entry keeps its own `assertCheckpointUnmoved` FOR UPDATE check (via
 * `commitDecoderAdapterBatch`'s per-entry `writeOutput`), in the order given —
 * callers must pass entries in the same fixed order `handleDecodedEventsReorg`
 * locks decoder checkpoints in, so a rewind and a batch commit racing each
 * other take locks in the same order and cannot deadlock. A rewind on ANY
 * entry aborts the whole transaction — nothing in the batch commits.
 */
export async function commitClassicDecoderBatch(
	entries: readonly GenericDecoderBatchEntry[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	const db = opts?.db ?? getSourceDb();
	await commitDecoderAdapterBatch(
		db,
		entries.map((entry) => ({
			stage_id: entry.decoderName,
			decoder_name: entry.decoderName,
			checkpoint_cursor: entry.checkpointCursor,
			failure: entry.failure ?? null,
			output_count: entry.rows.length,
			writeOutput: async (tx: Kysely<Database>) => {
				await assertCheckpointUnmoved({
					db: tx,
					decoderName: entry.decoderName,
					expected: entry.startedFrom,
				});
				await writeDecodedEvents(entry.rows, { db: tx });
			},
		})),
	);
}

/**
 * True log point for `decoder_checkpoint_advanced`: only when a checkpoint
 * write moves the committed height forward (not every mid-block cursor
 * bump within the same block). Pure and exported so it's unit-testable
 * without a live DB or a real Streams client — measurement only, no
 * behavior change to the commit path itself.
 */
export function checkpointAdvance(
	previousCursor: string | null,
	nextCursor: string | null,
	events: readonly { block_height: number; ts: string }[],
): { height: number; blockTime: string | null } | null {
	const previousHeight = committedHeight(previousCursor);
	const newHeight = committedHeight(nextCursor);
	if (newHeight === null || newHeight === previousHeight) return null;
	const matched = events.find((event) => event.block_height === newHeight);
	return { height: newHeight, blockTime: matched?.ts ?? null };
}
