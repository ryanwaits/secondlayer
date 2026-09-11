/**
 * Daily sweeper for expired play subgraphs and leftover ghost accounts.
 *
 * Deletes subgraphs whose expires_at is in the past (drops the schema).
 * Then deletes ghost accounts that have no remaining subgraphs and are
 * either older than 30 days or have no unused claim tokens. Never deletes
 * a ghost that still owns a subgraph. No-op in non-platform mode.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { deleteSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { getInstanceMode } from "@secondlayer/shared/mode";

const INTERVAL_MS = 24 * 60 * 60 * 1000;
const PLAY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function startPlayExpirySweepCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Play expiry sweep skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			await sweepExpiredPlay();
		} catch (err) {
			logger.error("Play expiry sweep error", {
				error: getErrorMessage(err),
			});
		}
	};

	const initial = setTimeout(tick, 20 * 60_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

export async function sweepExpiredPlay(
	now = new Date(),
): Promise<{ deletedSubgraphs: number; deletedGhosts: number }> {
	const db = getDb();
	const expired = await db
		.selectFrom("subgraphs")
		.select(["name", "account_id"])
		.where("expires_at", "is not", null)
		.where("expires_at", "<", now)
		.execute();

	let deletedSubgraphs = 0;
	for (const row of expired) {
		const deleted = await deleteSubgraph(db, row.name, row.account_id);
		if (deleted) deletedSubgraphs++;
	}

	const cutoff = new Date(now.getTime() - PLAY_TTL_MS);
	const ghosts = await db
		.selectFrom("accounts")
		.select(["id", "created_at"])
		.where("ghost", "=", true)
		.execute();

	let deletedGhosts = 0;
	for (const ghost of ghosts) {
		const remaining = await db
			.selectFrom("subgraphs")
			.select("id")
			.where("account_id", "=", ghost.id)
			.executeTakeFirst();
		if (remaining) continue;

		const unused = await db
			.selectFrom("claim_tokens")
			.select("id")
			.where("account_id", "=", ghost.id)
			.where("used_at", "is", null)
			.executeTakeFirst();

		const old = ghost.created_at < cutoff;
		if (!old && unused) continue;

		await db.deleteFrom("accounts").where("id", "=", ghost.id).execute();
		deletedGhosts++;
	}

	return { deletedSubgraphs, deletedGhosts };
}
