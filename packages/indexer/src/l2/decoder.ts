import {
	type DecodedEventRow,
	type StreamsClient,
	type StreamsEvent,
	type StreamsEventType,
	createStreamsClient,
	decodeFtBurn,
	decodeFtMint,
	decodeFtTransfer,
	decodeNftBurn,
	decodeNftMint,
	decodeNftTransfer,
	decodePrint,
	decodeStxBurn,
	decodeStxMint,
	decodeStxTransfer,
} from "@secondlayer/sdk";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import { defaultInternalStreamsApiKey } from "./internal-auth.ts";
import {
	FT_BURN_DECODER_NAME,
	FT_MINT_DECODER_NAME,
	FT_TRANSFER_DECODER_NAME,
	NFT_BURN_DECODER_NAME,
	NFT_MINT_DECODER_NAME,
	NFT_TRANSFER_DECODER_NAME,
	PRINT_DECODER_NAME,
	STX_BURN_DECODER_NAME,
	STX_MINT_DECODER_NAME,
	STX_TRANSFER_DECODER_NAME,
	readDecoderCheckpoint,
	writeDecodedEvents,
	writeDecoderCheckpoint,
} from "./storage.ts";

export {
	FT_TRANSFER_DECODER_NAME,
	L2_DECODER_NAMES,
	NFT_TRANSFER_DECODER_NAME,
} from "./storage.ts";

type DecodedEventConsumeOpts = {
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
};

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
		emptyBackoffMs: opts?.emptyBackoffMs,
		maxPages: opts?.maxPages,
		maxEmptyPolls: opts?.maxEmptyPolls,
		signal: opts?.signal,
		types: opts?.types ?? ["ft_transfer"],
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

export async function consumeNftTransferDecodedEvents(opts?: {
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
	const decoderName = opts?.decoderName ?? NFT_TRANSFER_DECODER_NAME;
	const streamsClient = opts?.streamsClient ?? createInternalStreamsClient();
	const startCursor =
		opts?.fromCursor !== undefined
			? opts.fromCursor
			: await readDecoderCheckpoint({ db, decoderName });
	let decoded = 0;

	const result = await streamsClient.events.consume({
		fromCursor: startCursor,
		batchSize: opts?.batchSize ?? 500,
		emptyBackoffMs: opts?.emptyBackoffMs,
		maxPages: opts?.maxPages,
		maxEmptyPolls: opts?.maxEmptyPolls,
		signal: opts?.signal,
		// Server-side filter — without this the streams query scans every
		// event type in the cursor range, which times out the API on big
		// backlogs and stalls the NFT decoder. Mirrors FT's default.
		types: opts?.types ?? ["nft_transfer"],
		onBatch: async (events, envelope) => {
			const rows = events.flatMap((event) => {
				if (event.event_type !== "nft_transfer") return [];
				try {
					return [decodeNftTransfer(event)];
				} catch (error) {
					logger.warn("l2_decoder.decode_skipped", {
						decoder: decoderName,
						cursor: event.cursor,
						tx_id: event.tx_id,
						error: String(error),
					});
					return [];
				}
			});
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

/**
 * Generic decoded-event consumer: server-side filtered by a single Streams
 * event type, decoded via the supplied SDK decoder, written to decoded_events.
 * Mirrors the ft/nft consumers (try/catch-per-event, checkpoint, progress) and
 * backs every type added after the original two.
 */
async function consumeDecodedEvents(
	config: {
		streamsType: StreamsEventType;
		defaultDecoderName: string;
		decode: (event: StreamsEvent) => DecodedEventRow;
	},
	opts?: DecodedEventConsumeOpts,
): Promise<{ cursor: string | null; pages: number; decoded: number }> {
	const db = opts?.db;
	const decoderName = opts?.decoderName ?? config.defaultDecoderName;
	const streamsClient = opts?.streamsClient ?? createInternalStreamsClient();
	const startCursor =
		opts?.fromCursor !== undefined
			? opts.fromCursor
			: await readDecoderCheckpoint({ db, decoderName });
	let decoded = 0;

	const result = await streamsClient.events.consume({
		fromCursor: startCursor,
		batchSize: opts?.batchSize ?? 500,
		emptyBackoffMs: opts?.emptyBackoffMs,
		maxPages: opts?.maxPages,
		maxEmptyPolls: opts?.maxEmptyPolls,
		signal: opts?.signal,
		types: opts?.types ?? [config.streamsType],
		onBatch: async (events, envelope) => {
			const rows = events.flatMap((event) => {
				if (event.event_type !== config.streamsType) return [];
				try {
					return [config.decode(event)];
				} catch (error) {
					logger.warn("l2_decoder.decode_skipped", {
						decoder: decoderName,
						cursor: event.cursor,
						tx_id: event.tx_id,
						error: String(error),
					});
					return [];
				}
			});
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

export const consumeStxTransferDecodedEvents = (
	opts?: DecodedEventConsumeOpts,
) =>
	consumeDecodedEvents(
		{
			streamsType: "stx_transfer",
			defaultDecoderName: STX_TRANSFER_DECODER_NAME,
			decode: decodeStxTransfer,
		},
		opts,
	);

export const consumeStxMintDecodedEvents = (opts?: DecodedEventConsumeOpts) =>
	consumeDecodedEvents(
		{
			streamsType: "stx_mint",
			defaultDecoderName: STX_MINT_DECODER_NAME,
			decode: decodeStxMint,
		},
		opts,
	);

export const consumeStxBurnDecodedEvents = (opts?: DecodedEventConsumeOpts) =>
	consumeDecodedEvents(
		{
			streamsType: "stx_burn",
			defaultDecoderName: STX_BURN_DECODER_NAME,
			decode: decodeStxBurn,
		},
		opts,
	);

export const consumeFtMintDecodedEvents = (opts?: DecodedEventConsumeOpts) =>
	consumeDecodedEvents(
		{
			streamsType: "ft_mint",
			defaultDecoderName: FT_MINT_DECODER_NAME,
			decode: decodeFtMint,
		},
		opts,
	);

export const consumeFtBurnDecodedEvents = (opts?: DecodedEventConsumeOpts) =>
	consumeDecodedEvents(
		{
			streamsType: "ft_burn",
			defaultDecoderName: FT_BURN_DECODER_NAME,
			decode: decodeFtBurn,
		},
		opts,
	);

export const consumeNftMintDecodedEvents = (opts?: DecodedEventConsumeOpts) =>
	consumeDecodedEvents(
		{
			streamsType: "nft_mint",
			defaultDecoderName: NFT_MINT_DECODER_NAME,
			decode: decodeNftMint,
		},
		opts,
	);

export const consumeNftBurnDecodedEvents = (opts?: DecodedEventConsumeOpts) =>
	consumeDecodedEvents(
		{
			streamsType: "nft_burn",
			defaultDecoderName: NFT_BURN_DECODER_NAME,
			decode: decodeNftBurn,
		},
		opts,
	);

export const consumePrintDecodedEvents = (opts?: DecodedEventConsumeOpts) =>
	consumeDecodedEvents(
		{
			streamsType: "print",
			defaultDecoderName: PRINT_DECODER_NAME,
			decode: decodePrint,
		},
		opts,
	);

function createInternalStreamsClient(): StreamsClient {
	return createStreamsClient({
		baseUrl: process.env.STREAMS_API_URL,
		apiKey: defaultInternalStreamsApiKey(),
	});
}
