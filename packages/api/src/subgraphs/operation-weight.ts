import type { Database } from "@secondlayer/shared";
import { getSourceDb } from "@secondlayer/shared/db";
import type { SparseProbeTarget } from "@secondlayer/subgraphs";
import { sql } from "kysely";
import type { Kysely } from "kysely";

/**
 * Operation weight classification — the admission control for the op queue.
 *
 * 'light' = contract-scoped sparse sync with a bounded candidate-event count:
 * the sparse reindex leaps between only this contract's events, so the op is
 * minutes-scale and many can run concurrently. Everything else (no contract
 * scope, tx-level sources, huge tokens) is 'heavy' and budgeted by the claim
 * query (`SUBGRAPH_HEAVY_OP_BUDGET`) so whale syncs can't hold every slot.
 *
 * Weight only gates admission — a "light" op that degrades to the DB-tap
 * fallback (no sparse probe) just runs slower; correctness is unaffected.
 */

export const LIGHT_MAX_EVENTS = 500_000;

export type OperationWeight = {
	weight: "light" | "heavy";
	/** Bounded candidate count — the honest progress denominator. Null when
	 *  the op isn't sparse-classifiable (heavy by structure, not by size). */
	estimatedEvents: number | null;
};

export async function classifyOperationWeight(
	probeTargets: SparseProbeTarget[] | null | undefined,
	fromBlock: number,
	toBlock: number,
	db: Kysely<Database> = getSourceDb(),
): Promise<OperationWeight> {
	if (!probeTargets?.length) return { weight: "heavy", estimatedEvents: null };
	if (probeTargets.some((t) => !t.contractId)) {
		return { weight: "heavy", estimatedEvents: null };
	}

	let total = 0;
	for (const t of probeTargets) {
		// LIMIT bounds the scan: past the light threshold we only need to know
		// "too big", not the exact count. `canonical` hits the partial index.
		const remaining = LIGHT_MAX_EVENTS + 1 - total;
		const { rows } = await sql<{ n: string | number }>`
			SELECT count(*) AS n FROM (
				SELECT 1 FROM decoded_events
				WHERE event_type = ${t.eventType}
					AND contract_id = ${t.contractId}
					AND canonical
					AND block_height BETWEEN ${fromBlock} AND ${toBlock}
				LIMIT ${remaining}
			) bounded
		`.execute(db);
		total += Number(rows[0]?.n ?? 0);
		if (total > LIGHT_MAX_EVENTS) {
			return { weight: "heavy", estimatedEvents: null };
		}
	}
	return { weight: "light", estimatedEvents: total };
}
