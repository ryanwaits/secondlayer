import { getSourceDb, sql } from "@secondlayer/shared/db";
import { ValidationError } from "@secondlayer/shared/errors";
import {
	defaultInternalIndexBaseUrl,
	requireInternalIndexApiKey,
} from "@secondlayer/shared/index-internal-auth";
import {
	type InferredTopicSchema,
	type PrintSample,
	inferPrintTopics,
} from "@secondlayer/subgraphs";
import type { IndexTip } from "./tip.ts";

/**
 * Empirical print-payload schema for a contract: sample bounded windows of
 * decoded print events, group by the tuple's `topic` discriminant, and infer
 * per-field Clarity/TS/ColumnType views via @secondlayer/subgraphs.
 *
 * Windows stay index-driven (newest/oldest by block_height under the
 * (contract_id, block_height, event_index) index) — the biggest print contract
 * has millions of rows, so no unbounded scans or aggregates.
 */

/** Newest-rows window: where the schema most likely reflects current code. */
const NEWEST_WINDOW = 1500;
/** Oldest-rows window: catches fields the contract stopped emitting. */
const OLDEST_WINDOW = 500;
/** Count cap — beyond this we report 50000 + total_events_capped: true. */
const COUNT_CAP = 50_000;

/** Loose Stacks contract principal shape — enough to 400 obvious garbage
 *  without rejecting short test/devnet ids. */
const CONTRACT_ID_PATTERN = /^S[0-9A-Z]{1,40}\.[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;

export function parsePrintSchemaContractId(raw: string): string {
	if (!CONTRACT_ID_PATTERN.test(raw)) {
		throw new ValidationError(
			"contract_id must be a Stacks contract principal (e.g. SP123….my-contract)",
		);
	}
	return raw;
}

export type PrintSchemaWindowRow = {
	cursor: string;
	block_height: number;
	payload: unknown;
};

export type PrintSchemaReadResult = {
	/** Deduped union of the newest + oldest windows. */
	rows: PrintSchemaWindowRow[];
	total_events: number;
	total_events_capped: boolean;
};

export type PrintSchemaReader = (params: {
	contractId: string;
}) => Promise<PrintSchemaReadResult>;

type WindowRow = {
	cursor: string;
	block_height: string | number;
	payload: unknown;
};

/** Two index-driven windows + a capped count over canonical print events.
 *  decoded_events lives on the SOURCE plane → getSourceDb, raw sql. */
export async function readPrintSchemaWindows(params: {
	contractId: string;
	db?: ReturnType<typeof getSourceDb>;
}): Promise<PrintSchemaReadResult> {
	const db = params.db ?? getSourceDb();
	const where = sql`contract_id = ${params.contractId} AND event_type = 'print' AND canonical = true`;

	const newest = await sql<WindowRow>`
		SELECT cursor, block_height, payload
		FROM decoded_events
		WHERE ${where}
		ORDER BY block_height DESC, event_index DESC
		LIMIT ${NEWEST_WINDOW}
	`.execute(db);
	const oldest = await sql<WindowRow>`
		SELECT cursor, block_height, payload
		FROM decoded_events
		WHERE ${where}
		ORDER BY block_height ASC, event_index ASC
		LIMIT ${OLDEST_WINDOW}
	`.execute(db);
	const counted = await sql<{ count: string | number }>`
		SELECT count(*) AS count
		FROM (SELECT 1 FROM decoded_events WHERE ${where} LIMIT ${COUNT_CAP + 1}) t
	`.execute(db);

	const seen = new Set<string>();
	const rows: PrintSchemaWindowRow[] = [];
	for (const row of [...newest.rows, ...oldest.rows]) {
		if (seen.has(row.cursor)) continue;
		seen.add(row.cursor);
		rows.push({
			cursor: row.cursor,
			block_height: Number(row.block_height),
			payload: row.payload,
		});
	}

	const rawCount = Number(counted.rows[0]?.count ?? 0);
	const capped = rawCount > COUNT_CAP;
	return {
		rows,
		total_events: capped ? COUNT_CAP : rawCount,
		total_events_capped: capped,
	};
}

/** Stored payload shape: { topic: "print", value, raw_value } — the stored
 *  topic is the node literal, useless; the real topic is value.topic. */
type StoredPrintPayload = Record<string, unknown>;

/** The payload jsonb is double-encoded (written via JSON.stringify), so the
 *  driver usually hands back a string — but parse defensively either way. */
function parseStoredPayload(raw: unknown): StoredPrintPayload | null {
	let value = raw;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as StoredPrintPayload;
}

/** Real topic = decoded tuple's `topic` field; missing/non-string → "*". */
function extractTopic(payload: StoredPrintPayload): string {
	const value = payload.value;
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const topic = (value as Record<string, unknown>).topic;
		if (typeof topic === "string") return topic;
	}
	return "*";
}

/** Canonical hex for typing: raw_value, else value when it's a 0x string
 *  (printValueHex precedent). Null → the row still counts, just untyped. */
function extractRawHex(payload: StoredPrintPayload): string | null {
	if (typeof payload.raw_value === "string") return payload.raw_value;
	if (typeof payload.value === "string" && payload.value.startsWith("0x")) {
		return payload.value;
	}
	return null;
}

export type PrintSchemaBody = {
	contract_id: string;
	topics: InferredTopicSchema[];
	sampled: boolean;
	total_events: number;
	total_events_capped: boolean;
	sample: {
		size: number;
		newest_height: number | null;
		oldest_height: number | null;
	};
};

export type PrintSchemaResponse = PrintSchemaBody & { tip: IndexTip };

const PRINT_SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
const PRINT_SCHEMA_CACHE_MAX_ENTRIES = 500;

/**
 * In-process TTL'd LRU over inferred schema bodies, keyed by contract_id.
 * Inference costs two window reads + up to a few hundred CV deserializations,
 * and schemas drift on contract-deploy timescales — a 5-min memo is safe.
 * Shared with the deploy-time print-field lint, which calls
 * getPrintSchemaBody directly. Only the tip-free body is cached.
 */
export class PrintSchemaCache {
	private readonly store = new Map<
		string,
		{ body: PrintSchemaBody; expiresAt: number }
	>();

	constructor(
		private readonly maxEntries: number = PRINT_SCHEMA_CACHE_MAX_ENTRIES,
		private readonly ttlMs: number = PRINT_SCHEMA_CACHE_TTL_MS,
	) {}

	get(key: string): PrintSchemaBody | undefined {
		const hit = this.store.get(key);
		if (hit === undefined) return undefined;
		if (hit.expiresAt <= Date.now()) {
			this.store.delete(key);
			return undefined;
		}
		// Refresh recency.
		this.store.delete(key);
		this.store.set(key, hit);
		return hit.body;
	}

	set(key: string, body: PrintSchemaBody): void {
		if (this.store.has(key)) this.store.delete(key);
		this.store.set(key, { body, expiresAt: Date.now() + this.ttlMs });
		while (this.store.size > this.maxEntries) {
			const oldest = this.store.keys().next().value;
			if (oldest === undefined) break;
			this.store.delete(oldest);
		}
	}

	get size(): number {
		return this.store.size;
	}

	clear(): void {
		this.store.clear();
	}
}

/** Shared cache for the live API process. */
export const printSchemaCache = new PrintSchemaCache();

/** Tip-free schema body — the cacheable unit, also the deploy-lint entry. */
export async function getPrintSchemaBody(opts: {
	contractId: string;
	read?: PrintSchemaReader;
	cache?: PrintSchemaCache;
}): Promise<PrintSchemaBody> {
	const cache = opts.cache ?? printSchemaCache;
	const cached = cache.get(opts.contractId);
	if (cached) return cached;

	const read = opts.read ?? readPrintSchemaWindows;
	const result = await read({ contractId: opts.contractId });

	const samples: PrintSample[] = [];
	for (const row of result.rows) {
		const payload = parseStoredPayload(row.payload);
		if (!payload) continue;
		samples.push({
			blockHeight: row.block_height,
			topic: extractTopic(payload),
			rawHex: extractRawHex(payload),
		});
	}

	let newestHeight: number | null = null;
	let oldestHeight: number | null = null;
	for (const sample of samples) {
		if (newestHeight === null || sample.blockHeight > newestHeight) {
			newestHeight = sample.blockHeight;
		}
		if (oldestHeight === null || sample.blockHeight < oldestHeight) {
			oldestHeight = sample.blockHeight;
		}
	}

	const body: PrintSchemaBody = {
		contract_id: opts.contractId,
		topics: inferPrintTopics(samples),
		// "sampled" reflects coverage of the windows themselves: rows we
		// EXAMINED (fetched), not rows that survived payload parsing.
		sampled: result.total_events > result.rows.length,
		total_events: result.total_events,
		total_events_capped: result.total_events_capped,
		sample: {
			size: samples.length,
			newest_height: newestHeight,
			oldest_height: oldestHeight,
		},
	};
	cache.set(opts.contractId, body);
	return body;
}

export async function getPrintSchemaResponse(opts: {
	contractId: string;
	tip: IndexTip;
	read?: PrintSchemaReader;
	cache?: PrintSchemaCache;
}): Promise<PrintSchemaResponse> {
	const body = await getPrintSchemaBody(opts);
	return { ...body, tip: opts.tip };
}

/**
 * Print schema read over HTTP from the hosted Index API, for stacks with no
 * local chain (a hosted tenant's decoded_events is empty). Same body shape as
 * the local path; the response's `tip` is dropped, and results share the
 * in-process cache. A missing contract (404) is an empty schema, like a local
 * contract with no observed prints. Any other failure throws, which the
 * deploy-time callers treat as "skip the check".
 */
export async function fetchHostedPrintSchema(
	contractId: string,
	opts: { fetchImpl?: typeof fetch; cache?: PrintSchemaCache } = {},
): Promise<PrintSchemaBody> {
	const cache = opts.cache ?? printSchemaCache;
	const cached = cache.get(contractId);
	if (cached) return cached;

	const baseUrl = defaultInternalIndexBaseUrl().replace(/\/+$/, "");
	const res = await (opts.fetchImpl ?? fetch)(
		`${baseUrl}/v1/index/contracts/${encodeURIComponent(contractId)}/print-schema`,
		{
			headers: {
				authorization: `Bearer ${requireInternalIndexApiKey()}`,
				accept: "application/json",
			},
		},
	);
	if (res.status === 404) {
		return {
			contract_id: contractId,
			topics: [],
			sampled: false,
			total_events: 0,
			total_events_capped: false,
			sample: { size: 0, newest_height: null, oldest_height: null },
		};
	}
	if (!res.ok) {
		throw new Error(`hosted print-schema read failed: ${res.status}`);
	}
	const { tip: _tip, ...body } = (await res.json()) as PrintSchemaResponse;
	cache.set(contractId, body);
	return body;
}
