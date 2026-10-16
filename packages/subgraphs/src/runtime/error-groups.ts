import { createHash } from "node:crypto";
import { getTargetDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { sql } from "kysely";

/** Keep at most this many error groups per subgraph. */
export const ERROR_GROUPS_CAP_PER_SUBGRAPH = 50;

const MESSAGE_MAX_CHARS = 500;

export interface HandlerErrorInput {
	subgraphName: string;
	sourceName: string;
	eventType: string | null;
	txId: string;
	blockHeight: number;
	err: unknown;
}

/** Strip values that vary per occurrence so repeats of one bug share a group. */
function normalizeMessage(message: string): string {
	return message
		.replace(/0x[0-9a-f]+/gi, "<hex>")
		.replace(/(["'`])(?:(?!\1).)*\1/g, "<str>")
		.replace(/\d+/g, "<n>");
}

export function errorFingerprint(input: {
	sourceName: string;
	eventType: string | null;
	message: string;
	frame: string | null;
}): string {
	return createHash("sha1")
		.update(
			[
				input.sourceName,
				input.eventType ?? "",
				normalizeMessage(input.message),
				input.frame ?? "",
			].join("|"),
		)
		.digest("hex");
}

/**
 * First stack line (after the message) carrying `file:line:col`, reduced to
 * `basename:line`. Null for non-Error throws or stackless errors.
 */
export function topFrame(err: unknown): string | null {
	if (!(err instanceof Error) || !err.stack) return null;
	for (const line of err.stack.split("\n").slice(1)) {
		const match = /([^/\\\s()]+):(\d+):\d+\)?\s*$/.exec(line);
		if (match) return `${match[1]}:${match[2]}`;
	}
	return null;
}

type HandlerErrorRecorder = (input: HandlerErrorInput) => Promise<void>;

interface PendingGroup {
	subgraphName: string;
	fingerprint: string;
	sourceName: string;
	eventType: string | null;
	message: string;
	frame: string | null;
	count: number;
	sampleTxId: string;
	sampleBlockHeight: number;
	firstSeenAt: Date;
	lastSeenAt: Date;
}

const FLUSH_INTERVAL_MS = 5_000;
/** Distinct (subgraph, fingerprint) keys held between flushes. */
const MAX_PENDING_KEYS = 1_000;

let pending = new Map<string, PendingGroup>();
let droppedKeys = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function startFlusher(): void {
	if (flushTimer) return;
	flushTimer = setInterval(() => {
		void flushHandlerErrors();
	}, FLUSH_INTERVAL_MS);
	// Never keep the process alive just to flush diagnostics.
	flushTimer.unref();
}

/**
 * Write the coalesced groups: one upsert per distinct fingerprint (adding the
 * accumulated count), then one cap-trim per distinct subgraph. Never throws.
 */
export async function flushHandlerErrors(): Promise<void> {
	if (pending.size === 0 && droppedKeys === 0) return;
	const batch = pending;
	const dropped = droppedKeys;
	pending = new Map();
	droppedKeys = 0;

	if (dropped > 0) {
		logger.warn("Handler error groups dropped: too many distinct errors", {
			dropped,
			cap: MAX_PENDING_KEYS,
		});
	}
	if (batch.size === 0) return;

	try {
		const db = getTargetDb();
		const subgraphs = new Set<string>();
		for (const group of batch.values()) {
			subgraphs.add(group.subgraphName);
			await db
				.insertInto("subgraph_error_groups")
				.values({
					subgraph_name: group.subgraphName,
					fingerprint: group.fingerprint,
					source_name: group.sourceName,
					event_type: group.eventType,
					message: group.message,
					frame: group.frame,
					count: group.count,
					sample_tx_id: group.sampleTxId,
					sample_block_height: group.sampleBlockHeight,
					first_seen: group.firstSeenAt,
					last_seen: group.lastSeenAt,
				})
				.onConflict((oc) =>
					oc.columns(["subgraph_name", "fingerprint"]).doUpdateSet({
						count: sql`subgraph_error_groups.count + ${group.count}`,
						last_seen: group.lastSeenAt,
						sample_tx_id: group.sampleTxId,
						sample_block_height: group.sampleBlockHeight,
					}),
				)
				.execute();
		}

		// Drop the least recently seen groups beyond the cap, once per subgraph.
		for (const subgraphName of subgraphs) {
			await sql`
				DELETE FROM subgraph_error_groups
				WHERE id IN (
					SELECT id FROM subgraph_error_groups
					WHERE subgraph_name = ${subgraphName}
					ORDER BY last_seen DESC, id
					OFFSET ${ERROR_GROUPS_CAP_PER_SUBGRAPH}
				)
			`.execute(db);
		}
	} catch (err) {
		logger.warn("Failed to flush handler error groups", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

let recorderOverride: HandlerErrorRecorder | null = null;

/** Test seam — receive each error directly instead of coalescing to the DB. */
export function setHandlerErrorRecorder(fn: HandlerErrorRecorder | null): void {
	recorderOverride = fn;
}

/**
 * Count a handler error against its fingerprint in memory (synchronous, no
 * DB); a timer flushes the totals. A failing handler can throw on every
 * event, so this must stay cheap and never throw into the block.
 */
export function recordHandlerError(input: HandlerErrorInput): void {
	try {
		if (recorderOverride) {
			recorderOverride(input).catch((err) => {
				logger.warn("Failed to record handler error group", {
					subgraph: input.subgraphName,
					error: err instanceof Error ? err.message : String(err),
				});
			});
			return;
		}

		const message = (
			input.err instanceof Error ? input.err.message : String(input.err)
		).slice(0, MESSAGE_MAX_CHARS);
		const frame = topFrame(input.err);
		const fingerprint = errorFingerprint({
			sourceName: input.sourceName,
			eventType: input.eventType,
			message,
			frame,
		});
		const key = `${input.subgraphName}|${fingerprint}`;
		const now = new Date();

		const existing = pending.get(key);
		if (existing) {
			existing.count++;
			existing.sampleTxId = input.txId;
			existing.sampleBlockHeight = input.blockHeight;
			existing.lastSeenAt = now;
		} else if (pending.size >= MAX_PENDING_KEYS) {
			droppedKeys++;
		} else {
			pending.set(key, {
				subgraphName: input.subgraphName,
				fingerprint,
				sourceName: input.sourceName,
				eventType: input.eventType,
				message,
				frame,
				count: 1,
				sampleTxId: input.txId,
				sampleBlockHeight: input.blockHeight,
				firstSeenAt: now,
				lastSeenAt: now,
			});
		}
		startFlusher();
	} catch (err) {
		logger.warn("Failed to record handler error group", {
			subgraph: input.subgraphName,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}
