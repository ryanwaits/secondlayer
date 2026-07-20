import {
	type StreamsClient,
	type StreamsEvent,
	type StreamsEventType,
	createStreamsClient,
} from "@secondlayer/sdk";
import type { Pox5EventTopic } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import { cvToValue, deserializeCV } from "@secondlayer/stacks/clarity";
import {
	POX5_CONTRACT_ID_MAINNET,
	POX5_EVENT_TOPICS,
} from "@secondlayer/stacks/pox5";
import type { Kysely } from "kysely";
import { defaultInternalStreamsApiKey } from "../internal-auth.ts";
import {
	POX5_DECODER_NAME,
	type Pox5EventRow,
	writePox5Events,
} from "../pox5-storage.ts";
import { readDecoderCheckpoint, writeDecoderCheckpoint } from "../storage.ts";

export { POX5_DECODER_NAME };

// Mainnet only — mirrors the pox-4 decoder's scope. pox-5 is a boot contract;
// the mainnet id is fixed at Epoch 4.0 activation (Bitcoin block 960,230).
// Unlike pox-2/3/4 there are NO node-synthesized events: every pox-5 event is
// a real `(print ...)` with a `topic` key and the tuple fields flattened at
// top level via `merge`.
const POX5_CONTRACT = POX5_CONTRACT_ID_MAINNET;

const STREAM_TYPES: StreamsEventType[] = ["print"];

const VALID_TOPICS = new Set<Pox5EventTopic>(POX5_EVENT_TOPICS);

export type ConsumePox5Options = {
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

/**
 * PoX-5 events decoder — `print` events on the pox-5 boot contract. Writes to
 * `pox5_events`. Tracks via the `decode.pox5.v1` checkpoint.
 *
 * Uses `batchSize: 100` and a server-side `contractId` filter for the same
 * reason sBTC/BNS do: an unfiltered streams scan from a stale checkpoint
 * exceeds Bun's fetch socket timeout. Pre-activation the filter matches
 * nothing and the consumer idles at tip.
 */
export async function consumePox5DecodedEvents(
	opts: ConsumePox5Options = {},
): Promise<{ cursor: string | null; pages: number; decoded: number }> {
	const db = opts.db;
	const decoderName = opts.decoderName ?? POX5_DECODER_NAME;
	const streamsClient = opts.streamsClient ?? createInternalStreamsClient();
	const startCursor =
		opts.fromCursor !== undefined
			? opts.fromCursor
			: await readDecoderCheckpoint({ db, decoderName });
	let decoded = 0;

	const result = await streamsClient.events.consume({
		fromCursor: startCursor,
		batchSize: opts.batchSize ?? 100,
		emptyBackoffMs: opts.emptyBackoffMs,
		maxPages: opts.maxPages,
		maxEmptyPolls: opts.maxEmptyPolls,
		signal: opts.signal,
		types: STREAM_TYPES,
		contractId: POX5_CONTRACT,
		onBatch: async (events, envelope) => {
			const rows: Pox5EventRow[] = [];
			for (const event of events) {
				try {
					if (
						event.event_type !== "print" ||
						event.contract_id !== POX5_CONTRACT
					) {
						continue;
					}
					const row = decodePox5Print(event);
					if (row) rows.push(row);
				} catch (error) {
					logger.warn("decoder.decode_skipped", {
						decoder: decoderName,
						cursor: event.cursor,
						tx_id: event.tx_id,
						event_type: event.event_type,
						error: String(error),
					});
				}
			}

			if (rows.length > 0) await writePox5Events(rows, { db });
			decoded += rows.length;

			if (envelope.next_cursor) {
				await writeDecoderCheckpoint({
					cursor: envelope.next_cursor,
					db,
					decoderName,
				});
			}
			await opts.onProgress?.({
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

export function decodePox5Print(event: StreamsEvent): Pox5EventRow | null {
	const payload = decodeClarityPayload(event.payload);
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const tuple = payload as Record<string, unknown>;
	const topicRaw = tuple.topic;
	if (typeof topicRaw !== "string") return null;
	if (!VALID_TOPICS.has(topicRaw as Pox5EventTopic)) {
		// pox-5 is an immutable boot contract, so an unknown topic means a
		// decode bug, not protocol drift. Log + skip; the raw event stays in
		// `events`/`decoded_events` regardless, so nothing is lost.
		logger.warn("pox5_decoder.unknown_topic", {
			cursor: event.cursor,
			topic: topicRaw,
		});
		return null;
	}
	const topic = topicRaw as Pox5EventTopic;

	const base: Pox5EventRow = {
		cursor: event.cursor,
		block_height: event.block_height,
		block_time: new Date(event.ts),
		tx_id: event.tx_id,
		tx_index: event.tx_index,
		event_index: event.event_index,
		topic,
		staker: null,
		signer: null,
		signer_manager: null,
		bond_index: null,
		amount_ustx: null,
		amount_sats: null,
		reward_cycle: null,
		first_reward_cycle: null,
		unlock_cycle: null,
		unlock_burn_height: null,
		is_l1_lock: null,
		signer_key: null,
		// Full decoded tuple, JSON-normalized (buffers → hex, bigints → strings).
		// Everything not promoted below stays queryable here — including
		// `stake-update`'s `prev-unlock-height`, which despite its name carries
		// a reward-CYCLE number (contract-side misnomer, immutable), so it is
		// deliberately NOT promoted into any height/cycle column.
		data: toJsonSafe(tuple),
		source_cursor: event.cursor,
	};

	return { ...base, ...promoteTopicFields(topic, tuple) };
}

// Per-topic promoted columns. Field names follow pox-5.clar's print tuples
// exactly; anything not listed here is reachable via the `data` JSONB.
function promoteTopicFields(
	topic: Pox5EventTopic,
	tuple: Record<string, unknown>,
): Partial<Pox5EventRow> {
	switch (topic) {
		case "set-bond-admin":
		case "set-pause-admin":
		case "pause-rewards":
			return {};
		case "setup-bond":
			return {
				bond_index: asInt64(tuple["bond-index"]),
				first_reward_cycle: asInt32(tuple["first-reward-cycle"]),
				unlock_cycle: asInt32(tuple["unlock-cycle"]),
				unlock_burn_height: asInt64(tuple["unlock-burn-height"]),
			};
		case "add-to-allowlist":
			return {
				staker: asString(tuple.staker),
				bond_index: asInt64(tuple["bond-index"]),
			};
		case "register-for-bond":
			return {
				signer: asString(tuple.signer),
				staker: asString(tuple.staker),
				amount_ustx: asDecimal(tuple["amount-ustx"]),
				amount_sats: asDecimal(tuple["sats-total"]),
				bond_index: asInt64(tuple["bond-index"]),
				first_reward_cycle: asInt32(tuple["first-reward-cycle"]),
				unlock_burn_height: asInt64(tuple["unlock-burn-height"]),
				unlock_cycle: asInt32(tuple["unlock-cycle"]),
				is_l1_lock: asBoolean(tuple["is-l1-lock"]),
			};
		case "update-bond-registration":
			return {
				staker: asString(tuple.staker),
				signer: asString(tuple.signer),
				bond_index: asInt64(tuple["bond-index"]),
				amount_ustx: asDecimal(tuple["amount-ustx"]),
				amount_sats: asDecimal(tuple["amount-sats"]),
				first_reward_cycle: asInt32(tuple["first-reward-cycle"]),
				is_l1_lock: asBoolean(tuple["is-l1-lock"]),
			};
		case "register-signer":
			return {
				signer: asString(tuple.signer),
				signer_key: asHex(tuple["signer-key"]),
			};
		case "stake":
			return {
				signer: asString(tuple.signer),
				staker: asString(tuple.staker),
				amount_ustx: asDecimal(tuple["amount-ustx"]),
				first_reward_cycle: asInt32(tuple["first-reward-cycle"]),
				unlock_burn_height: asInt64(tuple["unlock-burn-height"]),
				unlock_cycle: asInt32(tuple["unlock-cycle"]),
			};
		case "stake-update":
			return {
				staker: asString(tuple.staker),
				signer: asString(tuple.signer),
				amount_ustx: asDecimal(tuple["amount-ustx"]),
				unlock_burn_height: asInt64(tuple["unlock-burn-height"]),
				unlock_cycle: asInt32(tuple["unlock-cycle"]),
			};
		case "announce-l1-early-exit":
			return {
				staker: asString(tuple.staker),
				signer: asString(tuple.signer),
				bond_index: asInt64(tuple["bond-index"]),
				amount_sats: asDecimal(tuple["amount-sats-released"]),
			};
		case "unstake-sbtc":
			return {
				staker: asString(tuple.staker),
				signer: asString(tuple.signer),
				bond_index: asInt64(tuple["bond-index"]),
				amount_sats: asDecimal(tuple["amount-withdrawn-sats"]),
			};
		case "unstake":
			return {
				staker: asString(tuple.staker),
				signer: asString(tuple.signer),
				amount_ustx: asDecimal(tuple["amount-ustx"]),
				first_reward_cycle: asInt32(tuple["first-reward-cycle"]),
				unlock_cycle: asInt32(tuple["unlock-cycle"]),
				unlock_burn_height: asInt64(tuple["unlock-burn-height"]),
			};
		case "calculate-rewards":
			return {};
		case "bond-distribution":
			return {
				bond_index: asInt64(tuple["bond-index"]),
			};
		case "claim-rewards":
			return {
				reward_cycle: asInt32(tuple["reward-cycle"]),
				signer_manager: asString(tuple["signer-manager"]),
			};
		case "claim-staker-rewards-for-signer":
			return {
				signer_manager: asString(tuple["signer-manager"]),
				staker: asString(tuple.staker),
				reward_cycle: asInt32(tuple["reward-cycle"]),
				// (optional uint) — cvToValue unwraps `(some x)` to x, `none` to null.
				bond_index: asInt64(tuple["bond-index"]),
			};
		case "grant-signer-key":
			return {
				signer_key: asHex(tuple["signer-key"]),
				signer_manager: asString(tuple["signer-manager"]),
			};
		case "revoke-signer-grant":
			return {
				signer_key: asHex(tuple["signer-key"]),
				signer_manager: asString(tuple["signer-manager"]),
			};
	}
}

function decodeClarityPayload(payload: Record<string, unknown>): unknown {
	// Prefer canonical hex form (raw_value) over structured `value`.
	// See bns.decodeClarityPayload for rationale.
	if (typeof payload.raw_value === "string") {
		return decodeClarityHex(payload.raw_value);
	}
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

/**
 * Normalize a decoded Clarity value for JSONB storage: Uint8Array buffers →
 * `0x` hex strings, bigints → decimal strings, recursively through tuples,
 * lists, and unwrapped optionals. Without this, JSON.stringify turns buffers
 * into index-keyed objects.
 */
function toJsonSafe(value: unknown): unknown {
	if (value instanceof Uint8Array) {
		return `0x${Buffer.from(value).toString("hex")}`;
	}
	if (typeof value === "bigint") return value.toString();
	if (Array.isArray(value)) return value.map(toJsonSafe);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = toJsonSafe(v);
		return out;
	}
	return value;
}

// ── Clarity → typed-row coercions (house pattern: per-decoder copies) ──

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function asHex(value: unknown): string | null {
	if (typeof value === "string") {
		return value.startsWith("0x") ? value : `0x${value}`;
	}
	if (value instanceof Uint8Array)
		return `0x${Buffer.from(value).toString("hex")}`;
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

function asDecimal(value: unknown): string | null {
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "string") return value;
	return null;
}
