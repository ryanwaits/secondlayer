/**
 * Decoder-stage commit — generic (STX/FT/NFT/print) and protocol
 * (sBTC/PoX/BNS) producers share the atomic decoder adapter here.
 */

import {
	type DecoderAdapterFailure,
	type DecoderAdapterReceipt,
	commitDecoderAdapter,
	inputDigest,
} from "@secondlayer/shared/coverage";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { DecodedEventRow } from "@secondlayer/shared/streams-rows";
import type { Kysely } from "kysely";
import { writeDecodedEvents } from "./storage.ts";

export const GENERIC_DECODER_PRODUCER_VERSION = "v1";

export type GenericDecodeFault = "omission" | "version";

export function classifyGenericDecodeFault(error: unknown): GenericDecodeFault {
	const message = error instanceof Error ? error.message : String(error);
	if (/version|unsupported schema|unknown decoder/i.test(message)) {
		return "version";
	}
	return "omission";
}

export type GenericClockEvent = {
	cursor: string;
	block_height: number;
	block_hash: string;
	matched: boolean;
};

export function planGenericDecoderReceipts(
	events: readonly GenericClockEvent[],
): DecoderAdapterReceipt[] {
	const byHeight = new Map<
		number,
		{ hash: string; matched: string[]; last: string }
	>();
	for (const event of events) {
		const group = byHeight.get(event.block_height);
		if (!group) {
			byHeight.set(event.block_height, {
				hash: event.block_hash,
				matched: event.matched ? [event.cursor] : [],
				last: event.cursor,
			});
			continue;
		}
		if (event.matched) group.matched.push(event.cursor);
		group.last = event.cursor;
	}
	return [...byHeight.entries()]
		.sort(([a], [b]) => a - b)
		.map(([height, group]) => ({
			height,
			hash: group.hash,
			input_count: group.matched.length,
			input_cursors: group.matched,
			input_digest: inputDigest(group.matched),
			through_cursor: group.last,
			no_match: group.matched.length === 0,
			effect_digest: inputDigest(group.matched),
		}));
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
	receipts: readonly DecoderAdapterReceipt[];
	failure?: DecoderAdapterFailure | null;
	writeOutput: (tx: Kysely<Database>) => Promise<void>;
}): Promise<void> {
	const db = opts.db ?? getSourceDb();
	await commitDecoderAdapter(db, {
		stage_id: opts.decoderName,
		decoder_name: opts.decoderName,
		checkpoint_cursor: opts.checkpointCursor,
		receipts: opts.receipts,
		failure: opts.failure ?? null,
		writeOutput: (tx) => opts.writeOutput(tx as unknown as Kysely<Database>),
	});
}

export async function commitGenericDecoderBatch(opts: {
	db?: Kysely<Database>;
	decoderName: string;
	checkpointCursor: string | null;
	rows: readonly DecodedEventRow[];
	receipts: readonly DecoderAdapterReceipt[];
	failure?: DecoderAdapterFailure | null;
}): Promise<void> {
	await commitDecoderStageBatch({
		db: opts.db,
		decoderName: opts.decoderName,
		checkpointCursor: opts.checkpointCursor,
		receipts: opts.receipts,
		failure: opts.failure,
		writeOutput: (tx) =>
			writeDecodedEvents(opts.rows, {
				db: tx as unknown as Kysely<Database>,
			}),
	});
}
