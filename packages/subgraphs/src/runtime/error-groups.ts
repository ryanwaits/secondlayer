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

async function defaultRecordHandlerError(
	input: HandlerErrorInput,
): Promise<void> {
	const db = getTargetDb();
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

	await db
		.insertInto("subgraph_error_groups")
		.values({
			subgraph_name: input.subgraphName,
			fingerprint,
			source_name: input.sourceName,
			event_type: input.eventType,
			message,
			frame,
			sample_tx_id: input.txId,
			sample_block_height: input.blockHeight,
		})
		.onConflict((oc) =>
			oc.columns(["subgraph_name", "fingerprint"]).doUpdateSet({
				count: sql`subgraph_error_groups.count + 1`,
				last_seen: sql`now()`,
				sample_tx_id: input.txId,
				sample_block_height: input.blockHeight,
			}),
		)
		.execute();

	// Drop the least recently seen groups beyond the cap (same write path).
	await sql`
		DELETE FROM subgraph_error_groups
		WHERE id IN (
			SELECT id FROM subgraph_error_groups
			WHERE subgraph_name = ${input.subgraphName}
			ORDER BY last_seen DESC, id
			OFFSET ${ERROR_GROUPS_CAP_PER_SUBGRAPH}
		)
	`.execute(db);
}

let recorder: HandlerErrorRecorder = defaultRecordHandlerError;

/** Test seam — swap the persistence backend without mocking getTargetDb. */
export function setHandlerErrorRecorder(fn: HandlerErrorRecorder | null): void {
	recorder = fn ?? defaultRecordHandlerError;
}

/**
 * Group a handler error by fingerprint on the control plane. Failures are
 * logged, never thrown — a failing handler must not take the block down.
 */
export async function recordHandlerError(
	input: HandlerErrorInput,
): Promise<void> {
	try {
		await recorder(input);
	} catch (err) {
		logger.warn("Failed to record handler error group", {
			subgraph: input.subgraphName,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}
