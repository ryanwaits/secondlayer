import type { Database } from "@secondlayer/shared/db/schema";
import {
	consumeStreamsEvents,
	createHttpStreamsEventsFetcher,
	decodeFtTransfer,
	type Sleep,
	type StreamsEventsFetcher,
} from "@secondlayer/sdk";
import type { Kysely } from "kysely";
import {
	FT_TRANSFER_DECODER_NAME,
	readDecoderCheckpoint,
	writeDecodedEvents,
	writeDecoderCheckpoint,
} from "./storage.ts";

export async function consumeFtTransferDecodedEvents(opts?: {
	db?: Kysely<Database>;
	fetchEvents?: StreamsEventsFetcher;
	fromCursor?: string | null;
	batchSize?: number;
	emptyBackoffMs?: number;
	sleep?: Sleep;
	maxPages?: number;
	maxEmptyPolls?: number;
	decoderName?: string;
}): Promise<{ cursor: string | null; pages: number; decoded: number }> {
	const db = opts?.db;
	const decoderName = opts?.decoderName ?? FT_TRANSFER_DECODER_NAME;
	const fetchEvents = opts?.fetchEvents ?? createHttpStreamsEventsFetcher();
	const startCursor =
		opts?.fromCursor !== undefined
			? opts.fromCursor
			: await readDecoderCheckpoint({ db, decoderName });
	let decoded = 0;

	const result = await consumeStreamsEvents({
		fromCursor: startCursor,
		batchSize: opts?.batchSize ?? 500,
		types: ["ft_transfer"],
		fetchEvents,
		emptyBackoffMs: opts?.emptyBackoffMs,
		sleep: opts?.sleep,
		maxPages: opts?.maxPages,
		maxEmptyPolls: opts?.maxEmptyPolls,
		onBatch: async (events, envelope) => {
			const rows = events
				.filter((event) => event.event_type === "ft_transfer")
				.map((event) => decodeFtTransfer(event));
			await writeDecodedEvents(rows, { db });
			decoded += rows.length;

			if (envelope.next_cursor) {
				await writeDecoderCheckpoint({
					cursor: envelope.next_cursor,
					db,
					decoderName,
				});
			}
			return envelope.next_cursor;
		},
	});

	return { cursor: result.cursor, pages: result.pages, decoded };
}
