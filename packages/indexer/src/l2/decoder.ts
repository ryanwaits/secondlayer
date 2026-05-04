import {
	type StreamsClient,
	type StreamsEventType,
	createStreamsClient,
	decodeFtTransfer,
} from "@secondlayer/sdk";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import {
	FT_TRANSFER_DECODER_NAME,
	readDecoderCheckpoint,
	writeDecodedEvents,
	writeDecoderCheckpoint,
} from "./storage.ts";

export { FT_TRANSFER_DECODER_NAME } from "./storage.ts";

export async function consumeFtTransferDecodedEvents(opts?: {
	db?: Kysely<Database>;
	streamsClient?: StreamsClient;
	fromCursor?: string | null;
	batchSize?: number;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
	decoderName?: string;
	types?: readonly StreamsEventType[];
	onProgress?: (stats: {
		decoded: number;
		cursor: string | null;
		lagSeconds: number;
	}) => void | Promise<void>;
}): Promise<{ cursor: string | null; pages: number; decoded: number }> {
	const db = opts?.db;
	const decoderName = opts?.decoderName ?? FT_TRANSFER_DECODER_NAME;
	const streamsClient = opts?.streamsClient ?? createInternalStreamsClient();
	const startCursor =
		opts?.fromCursor !== undefined
			? opts.fromCursor
			: await readDecoderCheckpoint({ db, decoderName });
	let decoded = 0;

	const result = await streamsClient.events.consume({
		fromCursor: startCursor,
		batchSize: opts?.batchSize ?? 500,
		types: opts?.types,
		emptyBackoffMs: opts?.emptyBackoffMs,
		maxPages: opts?.maxPages,
		maxEmptyPolls: opts?.maxEmptyPolls,
		signal: opts?.signal,
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
			await opts?.onProgress?.({
				decoded: rows.length,
				cursor: envelope.next_cursor,
				lagSeconds: envelope.tip.lag_seconds,
			});
			return envelope.next_cursor;
		},
	});

	return { cursor: result.cursor, pages: result.pages, decoded };
}

function createInternalStreamsClient(): StreamsClient {
	return createStreamsClient({
		baseUrl: process.env.STREAMS_API_URL,
		apiKey: defaultInternalStreamsApiKey(),
	});
}

function defaultInternalStreamsApiKey(): string {
	const apiKey = process.env.STREAMS_INTERNAL_API_KEY;
	if (apiKey) return apiKey;
	if (process.env.NODE_ENV === "production") {
		throw new Error("STREAMS_INTERNAL_API_KEY is required in production");
	}
	return "sk-sl_streams_enterprise_test";
}
