/**
 * Hourly purge of ghost accounts: the account behind a signed-out reader's
 * docs key (`api/src/routes/public-docs-key.ts`). A ghost ended when its docs
 * key expired; it goes 7 days later, and the cascade takes its keys and
 * ledger rows with it. A ghost with any key that has no expiry, or one still
 * inside the 7 days, is kept. A ghost with no keys at all (a mint is one
 * transaction, so none should exist) has no key to say when it ended: it goes
 * 8 days after it was created. Accounts with `ghost = false` are never
 * touched. No-op outside platform mode.
 *
 * Deletes run in batches by id. A batch a row refuses (a foreign key that
 * does not cascade) falls back to one delete per id; the row that still
 * fails is logged and skipped for the rest of the run, not retried, and the
 * rest of the purge goes on.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { scheduleCron } from "./cron-schedule.ts";

const INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 7 * DAY_MS;
const KEYLESS_RETENTION_MS = 8 * DAY_MS;
const BATCH_SIZE = 500;

/** Ids of up to `BATCH_SIZE` ghosts due for deletion, skipping `skip`. */
async function dueGhostIds(now: Date, skip: ReadonlySet<string>) {
	const cutoff = new Date(now.getTime() - RETENTION_MS);
	const keylessCutoff = new Date(now.getTime() - KEYLESS_RETENTION_MS);
	let query = getDb()
		.selectFrom("accounts")
		.select("accounts.id")
		.where("accounts.ghost", "=", true)
		.where(({ eb, exists, not, selectFrom }) => {
			const keysOf = () =>
				selectFrom("api_keys")
					.select("api_keys.id")
					.whereRef("api_keys.account_id", "=", "accounts.id");
			return eb.or([
				// Has keys, and none is live or recent.
				eb.and([
					exists(keysOf()),
					not(
						exists(
							keysOf().where((k) =>
								k.or([
									k("api_keys.expires_at", "is", null),
									k("api_keys.expires_at", ">=", cutoff),
								]),
							),
						),
					),
				]),
				// No keys at all: age the account itself.
				eb.and([
					not(exists(keysOf())),
					eb("accounts.created_at", "<", keylessCutoff),
				]),
			]);
		})
		.orderBy("accounts.id")
		.limit(BATCH_SIZE);
	if (skip.size > 0) {
		query = query.where("accounts.id", "not in", [...skip]);
	}
	return (await query.execute()).map((row) => row.id);
}

async function deleteAccounts(ids: string[]): Promise<number> {
	const res = await getDb()
		.deleteFrom("accounts")
		.where("id", "in", ids)
		.where("ghost", "=", true)
		.executeTakeFirst();
	return Number(res.numDeletedRows);
}

/** Deletes ghosts that are due; returns the count. */
export async function purgeExpiredGhostAccounts(
	now = new Date(),
): Promise<number> {
	let deleted = 0;
	const skipped = new Set<string>();
	for (;;) {
		const ids = await dueGhostIds(now, skipped);
		if (ids.length === 0) return deleted;
		try {
			deleted += await deleteAccounts(ids);
		} catch {
			for (const id of ids) {
				try {
					deleted += await deleteAccounts([id]);
				} catch (err) {
					skipped.add(id);
					logger.error("Ghost account purge skipped an account", {
						accountId: id,
						error: getErrorMessage(err),
					});
				}
			}
		}
		if (ids.length < BATCH_SIZE) return deleted;
	}
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

	return scheduleCron(tick, 5 * 60_000, INTERVAL_MS);
}
