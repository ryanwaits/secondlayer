/**
 * Hourly purge of ghost accounts: the account behind a signed-out reader's
 * docs key (`api/src/routes/public-docs-key.ts`). A ghost goes 7 days after
 * its docs key expires; the cascade takes its keys and ledger rows with it.
 * A ghost with any key that has no expiry, or one still inside the 7 days, is
 * kept, and so is a ghost with no keys at all (nothing says when it ended).
 * Accounts with `ghost = false` are never touched. No-op outside platform mode.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";

const INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Deletes ghosts whose every key expired over 7 days before `now`; returns the count. */
export async function purgeExpiredGhostAccounts(
	now = new Date(),
): Promise<number> {
	const cutoff = new Date(now.getTime() - RETENTION_MS);
	const res = await getDb()
		.deleteFrom("accounts")
		.where("ghost", "=", true)
		.where(({ exists, selectFrom }) =>
			exists(
				selectFrom("api_keys")
					.select("api_keys.id")
					.whereRef("api_keys.account_id", "=", "accounts.id"),
			),
		)
		.where(({ not, exists, selectFrom }) =>
			not(
				exists(
					selectFrom("api_keys")
						.select("api_keys.id")
						.whereRef("api_keys.account_id", "=", "accounts.id")
						.where((k) =>
							k.or([
								k("api_keys.expires_at", "is", null),
								k("api_keys.expires_at", ">=", cutoff),
							]),
						),
				),
			),
		)
		.executeTakeFirst();
	return Number(res.numDeletedRows);
}

export function startGhostAccountsPurgeCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Ghost account purge cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			const deleted = await purgeExpiredGhostAccounts();
			if (deleted > 0) {
				logger.info("Purged expired ghost accounts", { deleted });
			}
		} catch (err) {
			logger.error("Ghost account purge cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	const initial = setTimeout(tick, 5 * 60_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}
