import {
	type StreamsClient,
	type StreamsEvent,
	type StreamsEventType,
	createStreamsClient,
} from "@secondlayer/sdk";
import {
	cvToValue,
	deserializeCV,
} from "@secondlayer/stacks/clarity";
import {
	SBTC_ASSET_IDENTIFIER_MAINNET,
	SBTC_CONTRACTS,
	SBTC_EVENT_TOPICS,
	type SbtcEventTopic,
} from "@secondlayer/stacks/sbtc";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import { defaultInternalStreamsApiKey } from "../internal-auth.ts";
import {
	SBTC_DECODER_NAME,
	type SbtcEventRow,
	type SbtcTokenEventRow,
	writeSbtcEvents,
	writeSbtcTokenEvents,
} from "../sbtc-storage.ts";
import {
	readDecoderCheckpoint,
	writeDecoderCheckpoint,
} from "../storage.ts";

export { SBTC_DECODER_NAME };

const SBTC_REGISTRY_CONTRACTS: readonly string[] = [
	`${SBTC_CONTRACTS.mainnet.address}.${SBTC_CONTRACTS.mainnet.registry}`,
	`${SBTC_CONTRACTS.testnet.address}.${SBTC_CONTRACTS.testnet.registry}`,
];

const SBTC_TOKEN_ASSET_IDS: readonly string[] = [
	SBTC_ASSET_IDENTIFIER_MAINNET,
	`${SBTC_CONTRACTS.testnet.address}.${SBTC_CONTRACTS.testnet.token}::sbtc-token`,
];

const STREAM_TYPES: StreamsEventType[] = [
	"print",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
];

const VALID_TOPICS = new Set<SbtcEventTopic>(SBTC_EVENT_TOPICS);

export type ConsumeSbtcOptions = {
	db?: Kysely<Database>;
	streamsClient?: StreamsClient;
	fromCursor?: string | null;
	batchSize?: number;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
	decoderName?: string;
	onProgress?: (stats: {
		decoded: number;
		cursor: string | null;
		lagSeconds: number;
	}) => void | Promise<void>;
};

export async function consumeSbtcDecodedEvents(
	opts: ConsumeSbtcOptions = {},
): Promise<{ cursor: string | null; pages: number; decoded: number }> {
	const db = opts.db;
	const decoderName = opts.decoderName ?? SBTC_DECODER_NAME;
	const streamsClient = opts.streamsClient ?? createInternalStreamsClient();
	const startCursor =
		opts.fromCursor !== undefined
			? opts.fromCursor
			: await readDecoderCheckpoint({ db, decoderName });
	let decoded = 0;

	const result = await streamsClient.events.consume({
		fromCursor: startCursor,
		batchSize: opts.batchSize ?? 500,
		emptyBackoffMs: opts.emptyBackoffMs,
		maxPages: opts.maxPages,
		maxEmptyPolls: opts.maxEmptyPolls,
		signal: opts.signal,
		types: STREAM_TYPES,
		onBatch: async (events, envelope) => {
			const registryRows: SbtcEventRow[] = [];
			const tokenRows: SbtcTokenEventRow[] = [];

			for (const event of events) {
				try {
					if (
						event.event_type === "print" &&
						event.contract_id !== null &&
						SBTC_REGISTRY_CONTRACTS.includes(event.contract_id)
					) {
						const row = decodeRegistryPrint(event);
						if (row) registryRows.push(row);
						continue;
					}

					if (
						(event.event_type === "ft_transfer" ||
							event.event_type === "ft_mint" ||
							event.event_type === "ft_burn") &&
						isSbtcTokenAsset(event)
					) {
						const row = decodeTokenEvent(event);
						if (row) tokenRows.push(row);
					}
				} catch (error) {
					logger.warn("l2_decoder.decode_skipped", {
						decoder: decoderName,
						cursor: event.cursor,
						tx_id: event.tx_id,
						event_type: event.event_type,
						error: String(error),
					});
				}
			}

			if (registryRows.length > 0) await writeSbtcEvents(registryRows, { db });
			if (tokenRows.length > 0) await writeSbtcTokenEvents(tokenRows, { db });
			decoded += registryRows.length + tokenRows.length;

			if (envelope.next_cursor) {
				await writeDecoderCheckpoint({
					cursor: envelope.next_cursor,
					db,
					decoderName,
				});
			}
			await opts.onProgress?.({
				decoded: registryRows.length + tokenRows.length,
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

function isSbtcTokenAsset(event: StreamsEvent): boolean {
	const asset = (event.payload as { asset_identifier?: unknown })
		.asset_identifier;
	return typeof asset === "string" && SBTC_TOKEN_ASSET_IDS.includes(asset);
}

export function decodeRegistryPrint(event: StreamsEvent): SbtcEventRow | null {
	const payload = decodeClarityPayload(event.payload);
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const tuple = payload as Record<string, unknown>;
	const topicRaw = tuple.topic;
	if (typeof topicRaw !== "string") return null;
	if (!VALID_TOPICS.has(topicRaw as SbtcEventTopic)) {
		// Unknown topic from a future protocol revision — log + skip.
		logger.warn("sbtc_decoder.unknown_topic", {
			cursor: event.cursor,
			topic: topicRaw,
		});
		return null;
	}
	const topic = topicRaw as SbtcEventTopic;

	const base = {
		cursor: event.cursor,
		block_height: event.block_height,
		block_time: new Date(event.ts),
		tx_id: event.tx_id,
		tx_index: event.tx_index,
		event_index: event.event_index,
		topic,
		source_cursor: event.cursor,
	};

	const empty = {
		request_id: null as number | null,
		amount: null as string | null,
		sender: null as string | null,
		recipient_btc_version: null as number | null,
		recipient_btc_hashbytes: null as string | null,
		bitcoin_txid: null as string | null,
		output_index: null as number | null,
		sweep_txid: null as string | null,
		burn_hash: null as string | null,
		burn_height: null as number | null,
		signer_bitmap: null as string | null,
		max_fee: null as string | null,
		fee: null as string | null,
		block_height_at_request: null as number | null,
		governance_contract_type: null as number | null,
		governance_new_contract: null as string | null,
		signer_aggregate_pubkey: null as string | null,
		signer_threshold: null as number | null,
		signer_address: null as string | null,
		signer_keys_count: null as number | null,
	};

	switch (topic) {
		case "completed-deposit":
			return {
				...base,
				...empty,
				bitcoin_txid: asHex(tuple["bitcoin-txid"]),
				output_index: asInt32(tuple["output-index"]),
				amount: asDecimal(tuple.amount),
				burn_hash: asHex(tuple["burn-hash"]),
				burn_height: asInt64(tuple["burn-height"]),
				sweep_txid: asHex(tuple["sweep-txid"]),
			};

		case "withdrawal-create": {
			const recipient = tuple.recipient;
			const btc =
				recipient && typeof recipient === "object"
					? (recipient as Record<string, unknown>)
					: null;
			return {
				...base,
				...empty,
				request_id: asInt64(tuple["request-id"]),
				amount: asDecimal(tuple.amount),
				sender: asString(tuple.sender),
				recipient_btc_version: btc ? asInt32FromHexByte(btc.version) : null,
				recipient_btc_hashbytes: btc ? asHex(btc.hashbytes) : null,
				block_height_at_request: asInt64(tuple["block-height"]),
				max_fee: asDecimal(tuple["max-fee"]),
			};
		}

		case "withdrawal-accept":
			return {
				...base,
				...empty,
				request_id: asInt64(tuple["request-id"]),
				bitcoin_txid: asHex(tuple["bitcoin-txid"]),
				signer_bitmap: asDecimal(tuple["signer-bitmap"]),
				output_index: asInt32(tuple["output-index"]),
				fee: asDecimal(tuple.fee),
				burn_hash: asHex(tuple["burn-hash"]),
				burn_height: asInt64(tuple["burn-height"]),
				sweep_txid: asHex(tuple["sweep-txid"]),
			};

		case "withdrawal-reject":
			return {
				...base,
				...empty,
				request_id: asInt64(tuple["request-id"]),
				signer_bitmap: asDecimal(tuple["signer-bitmap"]),
			};

		case "key-rotation": {
			const newKeys = tuple["new-keys"];
			return {
				...base,
				...empty,
				signer_aggregate_pubkey: asHex(tuple["new-aggregate-pubkey"]),
				signer_threshold: asInt32(tuple["new-signature-threshold"]),
				signer_address: asString(tuple["new-address"]),
				signer_keys_count: Array.isArray(newKeys) ? newKeys.length : null,
			};
		}

		case "update-protocol-contract":
			return {
				...base,
				...empty,
				governance_contract_type: asInt32FromHexByte(tuple["contract-type"]),
				governance_new_contract: asString(tuple["new-contract"]),
			};
	}
}

export function decodeTokenEvent(event: StreamsEvent): SbtcTokenEventRow | null {
	const payload = event.payload as Record<string, unknown>;
	const eventType: SbtcTokenEventRow["event_type"] | null =
		event.event_type === "ft_transfer"
			? "transfer"
			: event.event_type === "ft_mint"
				? "mint"
				: event.event_type === "ft_burn"
					? "burn"
					: null;
	if (!eventType) return null;

	const amount = asDecimal(payload.amount);
	if (amount === null) return null;

	const sender = asString(payload.sender);
	const recipient = asString(payload.recipient);

	return {
		cursor: event.cursor,
		block_height: event.block_height,
		block_time: new Date(event.ts),
		tx_id: event.tx_id,
		tx_index: event.tx_index,
		event_index: event.event_index,
		event_type: eventType,
		sender: eventType === "mint" ? null : sender,
		recipient: eventType === "burn" ? null : recipient,
		amount,
		memo: asHex(payload.memo),
		source_cursor: event.cursor,
	};
}

function decodeClarityPayload(payload: Record<string, unknown>): unknown {
	const value = payload.value;
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const v = value as Record<string, unknown>;
		if (typeof v.hex === "string") return decodeClarityHex(v.hex);
		// Already deserialized (test fixtures sometimes hand us a plain object)
		return v;
	}
	if (typeof value === "string") return decodeClarityHex(value);
	return null;
}

function decodeClarityHex(hex: string): unknown {
	const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
	const cv = deserializeCV(cleanHex);
	return cvToValue(cv);
}

// ── Clarity → typed-row coercions ─────────────────────────────────────

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function asHex(value: unknown): string | null {
	if (typeof value === "string") {
		return value.startsWith("0x") ? value : `0x${value}`;
	}
	if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString("hex")}`;
	return null;
}

function asInt64(value: unknown): number | null {
	if (typeof value === "bigint") {
		if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new Error(`int64 overflow: ${value.toString()}`);
		}
		return Number(value);
	}
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
	return null;
}

function asInt32(value: unknown): number | null {
	const n = asInt64(value);
	if (n === null) return null;
	if (n > 2_147_483_647 || n < -2_147_483_648) {
		throw new Error(`int32 overflow: ${n}`);
	}
	return n;
}

function asInt32FromHexByte(value: unknown): number | null {
	const hex = asHex(value);
	if (!hex) return null;
	const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
	if (stripped.length === 0) return null;
	return Number.parseInt(stripped.slice(0, 2), 16);
}

function asDecimal(value: unknown): string | null {
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "string") return value;
	return null;
}
