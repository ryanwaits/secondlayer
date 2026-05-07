import {
	type StreamsClient,
	type StreamsEvent,
	createStreamsClient,
} from "@secondlayer/sdk";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import type {
	BnsMarketplaceAction,
	BnsNameEventTopic,
	BnsNamespaceEventStatus,
} from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import { cvToValue, deserializeCV } from "@secondlayer/stacks/clarity";
import type { Kysely } from "kysely";
import {
	BNS_DECODER_NAME,
	type BnsMarketplaceEventRow,
	type BnsNameEventRow,
	type BnsNamespaceEventRow,
	deleteBnsName,
	upsertBnsName,
	upsertBnsNamespace,
	writeBnsMarketplaceEvents,
	writeBnsNameEvents,
	writeBnsNamespaceEvents,
} from "../bns-storage.ts";
import { defaultInternalStreamsApiKey } from "../internal-auth.ts";
import { readDecoderCheckpoint, writeDecoderCheckpoint } from "../storage.ts";

export { BNS_DECODER_NAME };

const BNS_V2_CONTRACTS: readonly string[] = [
	"SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2",
	"ST2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2",
];

const VALID_NAME_TOPICS = new Set<BnsNameEventTopic>([
	"new-name",
	"transfer-name",
	"renew-name",
	"burn-name",
	"new-airdrop",
]);

const VALID_NAMESPACE_STATUSES = new Set<BnsNamespaceEventStatus>([
	"launch",
	"transfer-manager",
	"freeze-manager",
	"update-price-manager",
	"freeze-price-manager",
	"turn-off-manager-transfers",
]);

const VALID_MARKETPLACE_ACTIONS = new Set<BnsMarketplaceAction>([
	"list-in-ustx",
	"unlist-in-ustx",
	"buy-in-ustx",
]);

export type ConsumeBnsOptions = {
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

export async function consumeBnsDecodedEvents(
	opts: ConsumeBnsOptions = {},
): Promise<{ cursor: string | null; pages: number; decoded: number }> {
	const db = opts.db;
	const decoderName = opts.decoderName ?? BNS_DECODER_NAME;
	const streamsClient = opts.streamsClient ?? createInternalStreamsClient();
	let startCursor =
		opts.fromCursor !== undefined
			? opts.fromCursor
			: await readDecoderCheckpoint({ db, decoderName });
	if (startCursor === null) {
		// First-time enable: seed checkpoint to current canonical tip so the
		// streams subscription has a meaningful starting point and the health
		// endpoint sees a recent checkpoint immediately. BNS-V2 prints are
		// sparse — without seeding, the decoder can sit silent for hours
		// before the first batch arrives.
		startCursor = await seedCheckpointToTip();
		if (startCursor !== null) {
			await writeDecoderCheckpoint({ db, decoderName, cursor: startCursor });
			logger.info("BNS decoder: seeded checkpoint to tip", {
				cursor: startCursor,
			});
		}
	} else {
		// Subsequent runs: bump checkpoint updated_at so health endpoint
		// reports `checkpoint_recent: true` immediately on container restart,
		// even before the streams subscription delivers its first batch.
		await writeDecoderCheckpoint({ db, decoderName, cursor: startCursor });
	}
	let decoded = 0;

	const result = await streamsClient.events.consume({
		fromCursor: startCursor,
		batchSize: opts.batchSize ?? 500,
		emptyBackoffMs: opts.emptyBackoffMs,
		maxPages: opts.maxPages,
		maxEmptyPolls: opts.maxEmptyPolls,
		signal: opts.signal,
		types: ["print"],
		onBatch: async (events, envelope) => {
			const nameRows: BnsNameEventRow[] = [];
			const namespaceRows: BnsNamespaceEventRow[] = [];
			const marketplaceRows: BnsMarketplaceEventRow[] = [];

			for (const event of events) {
				try {
					if (
						event.event_type !== "print" ||
						event.contract_id === null ||
						!BNS_V2_CONTRACTS.includes(event.contract_id)
					) {
						continue;
					}
					const payload = decodeClarityPayload(event.payload);
					if (
						!payload ||
						typeof payload !== "object" ||
						Array.isArray(payload)
					) {
						continue;
					}
					const tuple = payload as Record<string, unknown>;

					if (typeof tuple.topic === "string") {
						const row = decodeNameEvent(event, tuple);
						if (row) nameRows.push(row);
						continue;
					}
					if (typeof tuple.status === "string") {
						const row = decodeNamespaceEvent(event, tuple);
						if (row) namespaceRows.push(row);
						continue;
					}
					if (typeof tuple.a === "string") {
						const row = decodeMarketplaceEvent(event, tuple);
						if (row) marketplaceRows.push(row);
					}
				} catch (error) {
					logger.warn("l2_decoder.decode_skipped", {
						decoder: decoderName,
						cursor: event.cursor,
						tx_id: event.tx_id,
						error: String(error),
					});
				}
			}

			if (nameRows.length > 0) await writeBnsNameEvents(nameRows, { db });
			if (namespaceRows.length > 0)
				await writeBnsNamespaceEvents(namespaceRows, { db });
			if (marketplaceRows.length > 0)
				await writeBnsMarketplaceEvents(marketplaceRows, { db });

			// Apply projection updates after the event tables are durable.
			for (const row of nameRows) await applyNameProjection(row, db);
			for (const row of namespaceRows) await applyNamespaceProjection(row, db);

			decoded +=
				nameRows.length + namespaceRows.length + marketplaceRows.length;

			if (envelope.next_cursor) {
				await writeDecoderCheckpoint({
					cursor: envelope.next_cursor,
					db,
					decoderName,
				});
			}
			await opts.onProgress?.({
				decoded:
					nameRows.length + namespaceRows.length + marketplaceRows.length,
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

async function seedCheckpointToTip(): Promise<string | null> {
	const sourceDb = getSourceDb();
	const { rows } = await sql<{ height: number; max_event: number | null }>`
		SELECT b.height, max(e.event_index) AS max_event
		FROM blocks b
		LEFT JOIN events e ON e.block_height = b.height
		WHERE b.canonical = true
		GROUP BY b.height
		ORDER BY b.height DESC
		LIMIT 1
	`.execute(sourceDb);
	const row = rows[0];
	if (!row) return null;
	const eventIndex = row.max_event ?? 0;
	return `${row.height}:${eventIndex}`;
}

// ── Name-event decoder (topic discriminator) ────────────────────────────────

export function decodeNameEvent(
	event: StreamsEvent,
	tuple: Record<string, unknown>,
): BnsNameEventRow | null {
	const topicRaw = tuple.topic as string;
	if (!VALID_NAME_TOPICS.has(topicRaw as BnsNameEventTopic)) {
		logger.warn("bns_decoder.unknown_topic", {
			cursor: event.cursor,
			topic: topicRaw,
		});
		return null;
	}
	const topic = topicRaw as BnsNameEventTopic;

	const namespace = decodeBuffUtf8(tuple.namespace);
	const name = decodeBuffUtf8(tuple.name);
	if (!namespace || !name) return null;
	const fqn = `${name}.${namespace}`;

	const properties = asRecord(tuple.properties);
	const owner = asString(tuple.owner) ?? asString(properties?.owner);
	const bnsId = asDecimal(tuple.id) ?? asDecimal(properties?.id);
	if (!bnsId) return null;

	const registeredAt =
		asInt64(properties?.["registered-at"]) ?? asInt64(tuple["registered-at"]);
	const importedAt = asInt64(properties?.["imported-at"]);
	const renewalHeight = asInt64(properties?.["renewal-height"]);
	const stxBurn = asDecimal(properties?.["stx-burn"]);
	const preorderedBy = asString(properties?.["preordered-by"]);
	const hashedSaltedFqnPreorder = asHex(
		properties?.["hashed-salted-fqn-preorder"],
	);

	const cursorParsed = parseStreamsCursor(event.cursor);
	if (!cursorParsed) return null;

	return {
		cursor: event.cursor,
		block_height: cursorParsed.block_height,
		block_time: streamsTimestampToDate(event),
		tx_id: event.tx_id,
		tx_index: event.tx_index ?? 0,
		event_index: cursorParsed.event_index,
		topic,
		namespace,
		name,
		fqn,
		owner: topic === "burn-name" ? null : owner,
		bns_id: bnsId,
		registered_at: registeredAt,
		imported_at: importedAt,
		renewal_height: renewalHeight,
		stx_burn: stxBurn,
		preordered_by: preorderedBy,
		hashed_salted_fqn_preorder: hashedSaltedFqnPreorder,
		source_cursor: event.cursor,
	};
}

// ── Namespace-event decoder (status discriminator) ──────────────────────────

export function decodeNamespaceEvent(
	event: StreamsEvent,
	tuple: Record<string, unknown>,
): BnsNamespaceEventRow | null {
	const statusRaw = tuple.status as string;
	if (!VALID_NAMESPACE_STATUSES.has(statusRaw as BnsNamespaceEventStatus)) {
		logger.warn("bns_decoder.unknown_status", {
			cursor: event.cursor,
			status: statusRaw,
		});
		return null;
	}
	const status = statusRaw as BnsNamespaceEventStatus;

	const namespace = decodeBuffUtf8(tuple.namespace);
	if (!namespace) return null;

	const properties = asRecord(tuple.properties);
	const manager = asString(properties?.["namespace-manager"]);
	const managerFrozen = asBool(properties?.["manager-frozen"]);
	const managerTransfers = asBool(properties?.["manager-transfers"]);
	const priceFunctionRaw = properties?.["price-function"];
	const priceFunction =
		priceFunctionRaw !== undefined && priceFunctionRaw !== null
			? JSON.stringify(priceFunctionRaw, jsonReplacer)
			: null;
	const priceFrozen = asBool(properties?.["price-frozen"]);
	const lifetime = asInt64(properties?.lifetime);
	const revealedAt = asInt64(properties?.["revealed-at"]);
	const launchedAt = asInt64(properties?.["launched-at"]);

	const cursorParsed = parseStreamsCursor(event.cursor);
	if (!cursorParsed) return null;

	return {
		cursor: event.cursor,
		block_height: cursorParsed.block_height,
		block_time: streamsTimestampToDate(event),
		tx_id: event.tx_id,
		tx_index: event.tx_index ?? 0,
		event_index: cursorParsed.event_index,
		status,
		namespace,
		manager,
		manager_frozen: managerFrozen,
		manager_transfers_disabled:
			managerTransfers === null ? null : !managerTransfers,
		price_function: priceFunction,
		price_frozen: priceFrozen,
		lifetime,
		revealed_at: revealedAt,
		launched_at: launchedAt,
		source_cursor: event.cursor,
	};
}

// ── Marketplace-event decoder (a discriminator) ─────────────────────────────

export function decodeMarketplaceEvent(
	event: StreamsEvent,
	tuple: Record<string, unknown>,
): BnsMarketplaceEventRow | null {
	const actionRaw = tuple.a as string;
	if (!VALID_MARKETPLACE_ACTIONS.has(actionRaw as BnsMarketplaceAction)) {
		logger.warn("bns_decoder.unknown_action", {
			cursor: event.cursor,
			action: actionRaw,
		});
		return null;
	}
	const action = actionRaw as BnsMarketplaceAction;

	const bnsId = asDecimal(tuple.id);
	if (!bnsId) return null;

	const priceUstx = asDecimal(tuple.price ?? tuple["price-ustx"]);
	const commission = asString(tuple.commission);

	const cursorParsed = parseStreamsCursor(event.cursor);
	if (!cursorParsed) return null;

	return {
		cursor: event.cursor,
		block_height: cursorParsed.block_height,
		block_time: streamsTimestampToDate(event),
		tx_id: event.tx_id,
		tx_index: event.tx_index ?? 0,
		event_index: cursorParsed.event_index,
		action,
		bns_id: bnsId,
		price_ustx: priceUstx,
		commission,
		source_cursor: event.cursor,
	};
}

// ── Projection appliers ─────────────────────────────────────────────────────

async function applyNameProjection(
	row: BnsNameEventRow,
	db?: Kysely<Database>,
): Promise<void> {
	if (row.topic === "burn-name") {
		await deleteBnsName(row.fqn, { db });
		return;
	}
	if (!row.owner) return;
	await upsertBnsName(
		{
			fqn: row.fqn,
			namespace: row.namespace,
			name: row.name,
			owner: row.owner,
			bns_id: row.bns_id,
			registered_at: row.registered_at,
			renewal_height: row.renewal_height,
			last_event_cursor: row.cursor,
			last_event_at: row.block_time,
		},
		{ db },
	);
}

async function applyNamespaceProjection(
	row: BnsNamespaceEventRow,
	db?: Kysely<Database>,
): Promise<void> {
	await upsertBnsNamespace(
		{
			namespace: row.namespace,
			manager: row.manager,
			manager_frozen: row.manager_frozen ?? false,
			price_frozen: row.price_frozen ?? false,
			lifetime: row.lifetime,
			launched_at: row.launched_at,
			last_event_cursor: row.cursor,
			last_event_at: row.block_time,
		},
		{ db },
	);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function decodeClarityPayload(payload: Record<string, unknown>): unknown {
	const value = payload.value;
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const v = value as Record<string, unknown>;
		if (typeof v.hex === "string") return decodeClarityHex(v.hex);
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

function asRecord(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function asBool(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function asHex(value: unknown): string | null {
	if (typeof value === "string") {
		return value.startsWith("0x") ? value : `0x${value}`;
	}
	return null;
}

function asDecimal(value: unknown): string | null {
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "string" && value.length > 0) return value;
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

/** Decode a `(buff N)` hex string into a UTF-8 label, trimming trailing nulls. */
function decodeBuffUtf8(value: unknown): string | null {
	const hex = asHex(value);
	if (!hex) return null;
	const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
	if (stripped.length === 0) return null;
	const bytes = new Uint8Array(stripped.length / 2);
	for (let i = 0; i < bytes.length; i += 1) {
		bytes[i] = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
	}
	let end = bytes.length;
	while (end > 0 && bytes[end - 1] === 0) end -= 1;
	if (end === 0) return null;
	return new TextDecoder("utf-8").decode(bytes.subarray(0, end));
}

function parseStreamsCursor(
	cursor: string,
): { block_height: number; event_index: number } | null {
	const match = /^(\d+):(\d+)$/.exec(cursor);
	if (!match) return null;
	return {
		block_height: Number.parseInt(match[1] ?? "0", 10),
		event_index: Number.parseInt(match[2] ?? "0", 10),
	};
}

function streamsTimestampToDate(event: StreamsEvent): Date {
	const ts = (event as unknown as { block_time?: string | number | Date })
		.block_time;
	if (ts instanceof Date) return ts;
	if (typeof ts === "string") return new Date(ts);
	if (typeof ts === "number") return new Date(ts * 1000);
	return new Date();
}

function jsonReplacer(_key: string, value: unknown): unknown {
	return typeof value === "bigint" ? value.toString() : value;
}
