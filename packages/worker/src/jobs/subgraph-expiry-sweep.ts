/**
 * Daily sweeper for expired paid subgraphs.
 *
 * x402-paid (wallet-ghost) deploys carry `subgraphs.expires_at`; a renewal
 * payment pushes it forward and claiming the owning account clears it to
 * NULL. Anything still past its expiry gets the full teardown — PG schema
 * drop + registry row — via the same `deleteSubgraph` the authed DELETE
 * route uses, so locks/cascades behave identically.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { type Database, getDb } from "@secondlayer/shared/db";
import { deleteSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { getInstanceMode } from "@secondlayer/shared/mode";
import type { Kysely } from "kysely";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // daily — TTLs are week-scale

/** Delete every subgraph whose expiry has passed. Returns deleted names. */
export async function sweepExpiredSubgraphs(
	db: Kysely<Database>,
	now: Date = new Date(),
): Promise<string[]> {
	const expired = await db
		.selectFrom("subgraphs")
		.select(["name", "account_id"])
		.where("expires_at", "is not", null)
		.where("expires_at", "<", now)
		.execute();

	const deleted: string[] = [];
	for (const row of expired) {
		try {
			await deleteSubgraph(db, row.name, row.account_id ?? undefined);
			deleted.push(row.name);
		} catch (err) {
			// One stuck teardown must not block the rest of the sweep.
			logger.error("Expired-subgraph teardown failed", {
				subgraph: row.name,
				error: getErrorMessage(err),
			});
		}
	}
	return deleted;
}

export function startSubgraphExpirySweepCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Subgraph expiry sweep skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			const deleted = await sweepExpiredSubgraphs(getDb());
			if (deleted.length > 0) {
				logger.info("Swept expired paid subgraphs", {
					count: deleted.length,
					names: deleted,
				});
			}
		} catch (err) {
			logger.error("Subgraph expiry sweep error", {
				error: getErrorMessage(err),
			});
		}
	};

	void tick();
	const timer = setInterval(tick, INTERVAL_MS);
	return () => clearInterval(timer);
}
