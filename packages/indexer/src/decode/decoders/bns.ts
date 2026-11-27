import { getSourceDb, sql } from "@secondlayer/shared/db";
import type {
	BnsMarketplaceAction,
	BnsNameEventTopic,
	BnsNamespaceEventStatus,
} from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import type { StreamsEvent } from "@secondlayer/shared/streams-rows";
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
import {
	classifyGenericDecodeFault,
	commitDecoderStageBatch,
	failureFromFaults,
} from "../generic-commit.ts";

export { BNS_DECODER_NAME };

// v0 ships mainnet only; testnet kept here so the client-side filter still
// excludes it if the upstream node ever delivers testnet events through this
// stream. Server-side `contractId` filter targets
// the mainnet contract — that drives the actual fetch volume.
export const BNS_V2_MAINNET_CONTRACT =
	"SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2";
const BNS_V2_CONTRACTS: readonly string[] = [
	BNS_V2_MAINNET_CONTRACT,
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

export async function decodeBnsPage(opts: {
	db?: Kysely<Database>;
	decoderName?: string;
	events: readonly StreamsEvent[];
	checkpointCursor: string | null;
	startedFrom: string | null;
}): Promise<{ decoded: number }> {
	const decoderName = opts.decoderName ?? BNS_DECODER_NAME;
	const nameRows: BnsNameEventRow[] = [];
	const namespaceRows: BnsNamespaceEventRow[] = [];
	const marketplaceRows: BnsMarketplaceEventRow[] = [];
	const faults: {
		cursor: string;
		class: ReturnType<typeof classifyGenericDecodeFault>;
		error: string;
	}[] = [];

	for (const event of opts.events) {
		try {
			const decodedEvent = decodeBnsPrintEvent(event);
			if (!decodedEvent) continue;
			if (decodedEvent.kind === "name") nameRows.push(decodedEvent.row);
			else if (decodedEvent.kind === "namespace")
				namespaceRows.push(decodedEvent.row);
			else marketplaceRows.push(decodedEvent.row);
		} catch (error) {
			const fault = classifyGenericDecodeFault(error);
			logger.warn("decoder.decode_skipped", {
				decoder: decoderName,
				cursor: event.cursor,
				tx_id: event.tx_id,
				fault,
				error: String(error),
			});
			faults.push({
				cursor: event.cursor,
				class: fault,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const decoded =
		nameRows.length + namespaceRows.length + marketplaceRows.length;
	await commitDecoderStageBatch({
		db: opts.db,
		decoderName,
		checkpointCursor: opts.checkpointCursor,
		failure: failureFromFaults(faults),
		startedFrom: opts.startedFrom,
		outputCount: decoded,
		writeOutput: async (tx) => {
			if (nameRows.length > 0) await writeBnsNameEvents(nameRows, { db: tx });
			if (namespaceRows.length > 0)
				await writeBnsNamespaceEvents(namespaceRows, { db: tx });
			if (marketplaceRows.length > 0)
				await writeBnsMarketplaceEvents(marketplaceRows, { db: tx });
			for (const row of nameRows) await applyNameProjection(row, tx);
			for (const row of namespaceRows) await applyNamespaceProjection(row, tx);
		},
	});
	return { decoded };
}

export async function seedBnsCheckpointToTip(
	db?: Kysely<Database>,
): Promise<string | null> {
	const sourceDb = db ?? getSourceDb();
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

export type BnsDecodedEvent =
	| { kind: "name"; row: BnsNameEventRow }
	| { kind: "namespace"; row: BnsNamespaceEventRow }
	| { kind: "marketplace"; row: BnsMarketplaceEventRow };

export function decodeBnsPrintEvent(
	event: StreamsEvent,
): BnsDecodedEvent | null {
	if (event.event_type !== "print" || event.contract_id === null) return null;
	if (!BNS_V2_CONTRACTS.includes(event.contract_id)) return null;

	const payload = decodeClarityPayload(event.payload);
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const tuple = payload as Record<string, unknown>;

	if (typeof tuple.topic === "string") {
		const row = decodeNameEvent(event, tuple);
		return row ? { kind: "name", row } : null;
	}
	if (typeof tuple.status === "string") {
		const row = decodeNamespaceEvent(event, tuple);
		return row ? { kind: "namespace", row } : null;
	}
	if (typeof tuple.a === "string") {
		const row = decodeMarketplaceEvent(event, tuple);
		return row ? { kind: "marketplace", row } : null;
	}
	return null;
}

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

	const nameTuple = asRecord(tuple.name);
	const namespace = decodeBuffUtf8(nameTuple?.namespace ?? tuple.namespace);
	const name = decodeBuffUtf8(nameTuple?.name ?? tuple.name);
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
		block_time: new Date(event.ts),
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
	// bns-v2 prints `manager-transferable` and `can-update-price-function`;
	// the columns store their negations.
	const managerTransferable = asBool(properties?.["manager-transferable"]);
	const priceFunctionRaw = properties?.["price-function"];
	const priceFunction =
		priceFunctionRaw !== undefined && priceFunctionRaw !== null
			? JSON.stringify(priceFunctionRaw, jsonReplacer)
			: null;
	const canUpdatePrice = asBool(properties?.["can-update-price-function"]);
	const priceFrozen = canUpdatePrice === null ? null : !canUpdatePrice;
	const lifetime = asInt64(properties?.lifetime);
	const revealedAt = asInt64(properties?.["revealed-at"]);
	const launchedAt = asInt64(properties?.["launched-at"]);

	const cursorParsed = parseStreamsCursor(event.cursor);
	if (!cursorParsed) return null;

	return {
		cursor: event.cursor,
		block_height: cursorParsed.block_height,
		block_time: new Date(event.ts),
		tx_id: event.tx_id,
		tx_index: event.tx_index ?? 0,
		event_index: cursorParsed.event_index,
		status,
		namespace,
		manager,
		manager_frozen: managerFrozen,
		manager_transfers_disabled:
			managerTransferable === null ? null : !managerTransferable,
		price_function: priceFunction,
		price_frozen: priceFrozen,
		lifetime,
		revealed_at: revealedAt,
		launched_at: launchedAt,
		source_cursor: event.cursor,
	};
}

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
		block_time: new Date(event.ts),
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

function decodeClarityPayload(payload: Record<string, unknown>): unknown {
	// Prefer the canonical hex form (`raw_value`) — the streams API also
	// returns a `value` field with a structured `{Tuple: {data_map: ...}}`
	// shape that's tied to internal representation; consumers like the BNS
	// decoder need a flat record to dispatch on `topic`/`status`/`a`.
	if (typeof payload.raw_value === "string") {
		return decodeClarityHex(payload.raw_value);
	}
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

function jsonReplacer(_key: string, value: unknown): unknown {
	return typeof value === "bigint" ? value.toString() : value;
}
