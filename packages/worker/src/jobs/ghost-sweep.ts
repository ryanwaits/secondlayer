/**
 * Daily ghost-account sweeper.
 *
 * Ghost accounts (anonymous self-serve keys, `accounts.ghost = true`) that were
 * never claimed AND never used are deleted after 30 days:
 *   - created > 30d ago
 *   - no claim token ever used (a used token means claimed/merged — though a
 *     claimed account also has ghost=false, so this is belt-and-braces)
 *   - no api_key with last_used_at in the last 30 days (an actively used ghost
 *     key keeps the account alive even past the claim-URL expiry)
 *
 * The DELETE cascades api_keys + claim_tokens (+ usage rows) via FK
 * ON DELETE CASCADE — no manual child cleanup.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { type Database, getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import type { Kysely } from "kysely";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // daily — sweep cadence, not latency-sensitive
const GHOST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Delete expired, unclaimed, unused ghost accounts. Returns deleted ids. */
export async function sweepGhostAccounts(
	db: Kysely<Database>,
	now: Date = new Date(),
): Promise<string[]> {
	const cutoff = new Date(now.getTime() - GHOST_TTL_MS);
	const rows = await db
		.deleteFrom("accounts")
		.where("ghost", "=", true)
		.where("created_at", "<", cutoff)
		.where(({ not, exists, selectFrom }) =>
			not(
				exists(
					selectFrom("claim_tokens")
						.select("claim_tokens.id")
						.whereRef("claim_tokens.account_id", "=", "accounts.id")
						.where("claim_tokens.used_at", "is not", null),
				),
			),
		)
		.where(({ not, exists, selectFrom }) =>
			not(
				exists(
					selectFrom("api_keys")
						.select("api_keys.id")
						.whereRef("api_keys.account_id", "=", "accounts.id")
						.where("api_keys.last_used_at", ">", cutoff),
				),
			),
		)
		.returning("id")
		.execute();
	return rows.map((r) => r.id);
}

export function startGhostSweepCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Ghost sweep cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			const deleted = await sweepGhostAccounts(getDb());
			if (deleted.length > 0) {
				logger.info("Swept unclaimed ghost accounts", {
					count: deleted.length,
				});
			}
		} catch (err) {
			logger.error("Ghost sweep cron error", { error: getErrorMessage(err) });
		}
	};

	// Small offset so startup isn't a thundering herd of crons.
	const initial = setTimeout(tick, 5 * 60_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}
