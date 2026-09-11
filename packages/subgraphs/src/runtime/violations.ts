import { getTargetDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { sql } from "kysely";

/** Keep at most this many print-validate skips per subgraph. */
export const VIOLATIONS_CAP_PER_SUBGRAPH = 100;

export interface PrintViolationInput {
	subgraphName: string;
	sourceName: string;
	blockHeight: number;
	txId: string;
	reason: string;
	/** Bounded decoded camel payload — never raw_value hex dumps. */
	samplePayload: Record<string, unknown>;
}

function jsonSafe(value: unknown): unknown {
	if (typeof value === "bigint") return value.toString();
	if (value === null || value === undefined) return value;
	if (Array.isArray(value)) return value.map(jsonSafe);
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = jsonSafe(v);
		}
		return out;
	}
	return value;
}

type ViolationRecorder = (input: PrintViolationInput) => Promise<void>;

async function defaultRecordPrintViolation(
	input: PrintViolationInput,
): Promise<void> {
	try {
		const db = getTargetDb();
		const sample = jsonSafe(input.samplePayload) as Record<string, unknown>;
		await db
			.insertInto("subgraph_violations")
			.values({
				subgraph_name: input.subgraphName,
				source_name: input.sourceName,
				block_height: input.blockHeight,
				tx_id: input.txId,
				reason: input.reason,
				sample_payload: sample,
			})
			.execute();

		// Delete oldest beyond the cap (same write path; no separate sweep).
		await sql`
			DELETE FROM subgraph_violations
			WHERE id IN (
				SELECT id FROM subgraph_violations
				WHERE subgraph_name = ${input.subgraphName}
				ORDER BY seen_at DESC
				OFFSET ${VIOLATIONS_CAP_PER_SUBGRAPH}
			)
		`.execute(db);
	} catch (err) {
		logger.warn("Failed to record print violation", {
			subgraph: input.subgraphName,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

let recorder: ViolationRecorder = defaultRecordPrintViolation;

/** Test seam — swap the persistence backend without mocking getTargetDb. */
export function setPrintViolationRecorder(fn: ViolationRecorder | null): void {
	recorder = fn ?? defaultRecordPrintViolation;
}

/**
 * Persist a print-validate skip on the control plane and trim to the cap.
 * Failures are logged, never thrown — a poisoned block must still commit.
 */
export async function recordPrintViolation(
	input: PrintViolationInput,
): Promise<void> {
	await recorder(input);
}
