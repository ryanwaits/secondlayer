import { type StreamsClient, createStreamsClient } from "@secondlayer/sdk";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import type {
	StreamsEvent,
	StreamsEventType,
} from "@secondlayer/shared/streams-rows";
import {
	type DecodedEventRow,
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
import {
	classifyGenericDecodeFault,
	commitGenericDecoderBatch,
	failureFromFaults,
	planGenericDecoderReceipts,
} from "./generic-commit.ts";
import { requireInternalStreamsApiKey } from "./internal-auth.ts";
import {
	FT_BURN_DECODER_NAME,
	FT_MINT_DECODER_NAME,
	FT_TRANSFER_DECODER_NAME,
	NFT_BURN_DECODER_NAME,
	NFT_MINT_DECODER_NAME,
	NFT_TRANSFER_DECODER_NAME,
	PRINT_DECODER_NAME,
	STX_BURN_DECODER_NAME,
	STX_LOCK_DECODER_NAME,
	STX_MINT_DECODER_NAME,
	STX_TRANSFER_DECODER_NAME,
	readDecoderCheckpoint,
} from "./storage.ts";

export {
	DECODER_NAMES,
	FT_TRANSFER_DECODER_NAME,
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
	/** Test hook: decode and plan the batch without opening a database. */
	skipPersist?: boolean;
};

/**
 * Generic decoded-event consumer: server-side filtered by a single Streams
 * event type, decoded via the supplied SDK decoder, committed through the
 * atomic adapter (output + checkpoint + receipt + omission/version failure).
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
			const faults: {
				cursor: string;
				class: ReturnType<typeof classifyGenericDecodeFault>;
				error: string;
			}[] = [];
			const clockEvents: {
				cursor: string;
				block_height: number;
				block_hash: string;
				matched: boolean;
			}[] = [];
			const rows = events.flatMap((event) => {
				if (event.event_type !== config.streamsType) {
					clockEvents.push({
						cursor: event.cursor,
						block_height: event.block_height,
						block_hash: event.block_hash,
						matched: false,
					});
					faults.push({
						cursor: event.cursor,
						class: "omission",
						error: `event_type ${event.event_type} omitted by ${config.streamsType} decoder`,
					});
					return [];
				}
				try {
					const row = config.decode(event);
					clockEvents.push({
						cursor: event.cursor,
						block_height: event.block_height,
						block_hash: event.block_hash,
						matched: true,
					});
					return [row];
				} catch (error) {
					const fault = classifyGenericDecodeFault(error);
					logger.warn("decoder.decode_skipped", {
						decoder: decoderName,
						cursor: event.cursor,
						tx_id: event.tx_id,
						fault,
						error: String(error),
					});
					clockEvents.push({
						cursor: event.cursor,
						block_height: event.block_height,
						block_hash: event.block_hash,
						matched: false,
					});
					faults.push({
						cursor: event.cursor,
						class: fault,
						error: error instanceof Error ? error.message : String(error),
					});
					return [];
				}
			});
			if (!opts?.skipPersist) {
				await commitGenericDecoderBatch({
					db,
					decoderName,
					checkpointCursor: envelope.next_cursor,
					rows,
					receipts: planGenericDecoderReceipts(clockEvents),
					failure: failureFromFaults(faults),
				});
			}
			decoded += rows.length;
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

export const consumeFtTransferDecodedEvents = (
	opts?: DecodedEventConsumeOpts,
) =>
	consumeDecodedEvents(
		{
			streamsType: "ft_transfer",
			defaultDecoderName: FT_TRANSFER_DECODER_NAME,
			decode: decodeFtTransfer,
		},
		opts,
	);

export const consumeNftTransferDecodedEvents = (
	opts?: DecodedEventConsumeOpts,
) =>
	consumeDecodedEvents(
		{
			streamsType: "nft_transfer",
			defaultDecoderName: NFT_TRANSFER_DECODER_NAME,
			decode: decodeNftTransfer,
		},
		opts,
	);

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

export const consumeStxLockDecodedEvents = (opts?: DecodedEventConsumeOpts) =>
	consumeDecodedEvents(
		{
			streamsType: "stx_lock",
			defaultDecoderName: STX_LOCK_DECODER_NAME,
			decode: decodeStxLock,
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
		apiKey: requireInternalStreamsApiKey(),
	});
}
