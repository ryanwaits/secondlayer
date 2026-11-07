import { createHash } from "node:crypto";
import {
	type Database,
	OBSERVER_JOURNAL_STATUSES,
	type ObserverJournalStatus,
	jsonb,
} from "@secondlayer/shared/db";
import {
	casTransition,
	defineMachine,
} from "@secondlayer/shared/db/transition";
import { logger } from "@secondlayer/shared/logger";
import { type Kysely, sql } from "kysely";

/**
 * A journal row is a receipt: it is `received` until something decides its
 * fate, and every later state is terminal except `failed` (which becomes
 * `retried` once the node redelivers the same bytes and they succeed).
 *
 *   received -> processed   derived state committed
 *   received -> failed      a live caller was told the apply failed (node re-sends)
 *   received -> poisoned    the same error N times in a row: alert, skip
 *   received -> skipped     deliberately never applied (refused spool, superseded burn block)
 *   failed   -> retried     the identical body was later processed
 */
export const OBSERVER_JOURNAL_MACHINE = defineMachine({
	states: OBSERVER_JOURNAL_STATUSES,
	transitions: {
		received: ["processed", "failed", "poisoned", "skipped"],
		failed: ["retried"],
	},
});

/** Consecutive identical apply errors after which a row is poisoned. */
export const POISON_AFTER = 10;

export type ObserverPath = "/new_block" | "/new_burn_block";

export interface ObserverReceipt {
	sequence: string;
	path: ObserverPath;
	body: Buffer;
	rawBodySha256: string;
}

export interface ObserverProcessedFields {
	path: ObserverPath;
	payload: unknown;
	result: unknown;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function sha256Hex(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** Stable JSON encoding for semantic comparisons across runtimes. */
export function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Cannot hash non-finite JSON");
		return JSON.stringify(value);
	}
	if (typeof value === "bigint") return JSON.stringify(value.toString());
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	if (typeof value === "object") {
		const object = value as Record<string, unknown>;
		return `{${Object.keys(object)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
			.join(",")}}`;
	}
	return "null";
}

export function semanticObserverSha256(
	path: ObserverPath,
	payload: unknown,
): string {
	return sha256Hex(canonicalJson({ path, payload }));
}

export function parseObserverBody<T>(body: Uint8Array): T {
	return JSON.parse(textDecoder.decode(body)) as T;
}

function stringField(payload: unknown, key: string): string | null {
	if (!payload || typeof payload !== "object") return null;
	const value = (payload as Record<string, unknown>)[key];
	return typeof value === "string" ? value : null;
}

function numberField(payload: unknown, key: string): number | null {
	if (!payload || typeof payload !== "object") return null;
	const value = (payload as Record<string, unknown>)[key];
	return typeof value === "number" && Number.isSafeInteger(value)
		? value
		: null;
}

export async function appendObserverReceipt(
	db: Kysely<Database>,
	input: {
		network: string;
		path: ObserverPath;
		source: string | null;
		body: Uint8Array;
	},
): Promise<ObserverReceipt> {
	const body = Buffer.from(input.body);
	const rawBodySha256 = sha256Hex(body);
	// Receipt transaction is the acknowledgement durability boundary. The
	// local setting makes the insert wait for WAL flush before parsing.
	const row = await db.transaction().execute(async (tx) => {
		await sql`SET LOCAL synchronous_commit = 'on'`.execute(tx);
		return tx
			.insertInto("observer_journal")
			.values({
				network: input.network,
				path: input.path,
				source: input.source,
				raw_body: body,
				raw_body_sha256: rawBodySha256,
				status: "received",
				semantic_sha256: null,
				block_height: null,
				block_hash: null,
				burn_block_height: null,
				burn_block_hash: null,
				result: null,
				error: null,
				processed_at: null,
			})
			.returning("sequence")
			.executeTakeFirstOrThrow();
	});

	return {
		sequence: String(row.sequence),
		path: input.path,
		body,
		rawBodySha256,
	};
}

interface JournalFields {
	semantic_sha256: string | null;
	block_height: number | null;
	block_hash: string | null;
	burn_block_height: number | null;
	burn_block_hash: string | null;
	result: unknown | null;
	error: string | null;
}

/**
 * Move a receipt between states, only if it is still in one of `from`. `false`
 * means another writer (a second indexer, a redelivery) decided it first: the
 * caller logs and stops, it never overwrites.
 */
export async function transitionJournal(
	db: Kysely<Database>,
	sequence: string,
	from: readonly ObserverJournalStatus[],
	to: ObserverJournalStatus,
	fields: Partial<JournalFields> = {},
): Promise<boolean> {
	for (const f of from) OBSERVER_JOURNAL_MACHINE.assert(f, to);
	const set: Record<string, unknown> = { ...fields };
	if ("result" in fields) {
		set.result = fields.result == null ? null : jsonb(fields.result);
	}
	// `retried` only relabels an earlier failure; its timestamps stay.
	if (to !== "retried") set.processed_at = new Date();
	const row = await casTransition(db, {
		table: "observer_journal",
		key: "sequence",
		id: sequence,
		from,
		to,
		stampUpdatedAt: false,
		returning: ["sequence"],
		set,
	});
	return row !== null;
}

export async function markObserverProcessed(
	db: Kysely<Database>,
	receipt: ObserverReceipt,
	fields: ObserverProcessedFields,
): Promise<boolean> {
	const payload = fields.payload;
	const moved = await transitionJournal(
		db,
		receipt.sequence,
		["received"],
		"processed",
		{
			semantic_sha256: semanticObserverSha256(fields.path, payload),
			block_height: numberField(payload, "block_height"),
			block_hash: stringField(payload, "block_hash"),
			burn_block_height: numberField(payload, "burn_block_height"),
			burn_block_hash: stringField(payload, "burn_block_hash"),
			result: fields.result,
			error: null,
		},
	);
	if (!moved) {
		logger.warn("Observer receipt was no longer received; left as is", {
			sequence: receipt.sequence,
		});
		return false;
	}
	// The node redelivered identical bytes and they succeeded: earlier failures
	// of this exact body are resolved. `failed` stays "unresolved".
	if (receipt.rawBodySha256) {
		const resolved = await db
			.selectFrom("observer_journal")
			.select("sequence")
			.where("status", "=", "failed")
			.where("raw_body_sha256", "=", receipt.rawBodySha256)
			.where("sequence", "<", receipt.sequence)
			.execute();
		for (const { sequence } of resolved) {
			await transitionJournal(db, String(sequence), ["failed"], "retried");
		}
	}
	return true;
}

export async function markObserverFailed(
	db: Kysely<Database>,
	receipt: ObserverReceipt,
	error: unknown,
): Promise<boolean> {
	return transitionJournal(db, receipt.sequence, ["received"], "failed", {
		error: error instanceof Error ? error.message : String(error),
	});
}

export interface JournalBacklog {
	/** Unapplied `/new_block` receipts. */
	received: number;
	oldestReceivedAt: Date | null;
	/** Receipts that failed and were never redelivered successfully. */
	failed: number;
	/** Receipts skipped after repeating the same error. */
	poisoned: number;
}

/**
 * The one backlog query: `/health/integrity` and the applier both read it, so
 * they can never disagree about what "pending" means. Only `/new_block`
 * receipts count as backlog: those are what the applier drains (burn receipts
 * are applied inline; orphans are replayed or skipped by the applier).
 */
export async function journalBacklog(
	db: Kysely<Database>,
	network: string,
): Promise<JournalBacklog> {
	const { rows } = await sql<{
		received: number;
		oldest: Date | null;
		failed: number;
		poisoned: number;
	}>`
		SELECT
			count(*) FILTER (WHERE status = 'received' AND path = '/new_block')::int AS received,
			min(received_at) FILTER (WHERE status = 'received' AND path = '/new_block') AS oldest,
			count(*) FILTER (WHERE status = 'failed')::int AS failed,
			count(*) FILTER (WHERE status = 'poisoned')::int AS poisoned
		  FROM observer_journal
		 WHERE network = ${network}
		   AND status IN ('received', 'failed', 'poisoned')
	`.execute(db);
	const row = rows[0];
	return {
		received: Number(row?.received ?? 0),
		oldestReceivedAt: row?.oldest ? new Date(row.oldest) : null,
		failed: Number(row?.failed ?? 0),
		poisoned: Number(row?.poisoned ?? 0),
	};
}

/**
 * Counts consecutive identical failures per receipt. A different message
 * resets the count: only a repeating error is treated as deterministic.
 */
export class FailureTracker {
	private readonly seen = new Map<string, { message: string; count: number }>();

	/** Record a failure; returns how many times in a row this message has hit. */
	record(sequence: string, message: string): number {
		const prev = this.seen.get(sequence);
		const count = prev?.message === message ? prev.count + 1 : 1;
		this.seen.set(sequence, { message, count });
		return count;
	}

	clear(sequence: string): void {
		this.seen.delete(sequence);
	}
}

export function bodyFromText(text: string): Uint8Array {
	return textEncoder.encode(text);
}
