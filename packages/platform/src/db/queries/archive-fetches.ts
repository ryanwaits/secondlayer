import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

/**
 * The archive fetch gate's charge log (design-f089). Append-only: one row
 * per priced attempt to fetch a partition object from the API's
 * `/api/archive/{quote,fetch}` routes. Two read paths this module serves:
 *
 *   - `recentChargedPaths` — the 24h re-issue window. A path already paid
 *     for by this account within the last day re-presigns for free.
 *   - `allowancePartitionsUsedThisMonth` — the monthly free-repair
 *     allowance counter (partitions, not bundles — the route divides by 3
 *     when reporting bundles to the caller).
 *
 * Mirrors `account-credits.ts` in this directory: plain functions over an
 * injected `Kysely<Database>` (or `Transaction<Database>`, which extends
 * it), so the archive route can run the whole charge-and-log sequence
 * inside one DB transaction.
 */

export type ArchiveFetchRecord = {
	accountId: string;
	path: string;
	dataset: string;
	usdMicros: bigint;
	viaAllowance: boolean;
};

const RE_ISSUE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The subset of `paths` this account already paid for within the last 24h. */
export async function recentChargedPaths(
	db: Kysely<Database>,
	accountId: string,
	paths: string[],
	now: Date = new Date(),
): Promise<Set<string>> {
	if (paths.length === 0) return new Set();
	const cutoff = new Date(now.getTime() - RE_ISSUE_WINDOW_MS);
	const rows = await db
		.selectFrom("archive_fetches")
		.select("path")
		.where("account_id", "=", accountId)
		.where("path", "in", paths)
		.where("charged_at", ">", cutoff)
		.execute();
	return new Set(rows.map((row) => row.path));
}

/** UTC calendar-month bounds `now` falls in: `[start, end)`. */
function monthBounds(now: Date): { start: Date; end: Date } {
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const end = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
	);
	return { start, end };
}

/** Count of partitions this account has pulled via the free repair allowance
 *  in `now`'s UTC calendar month. */
export async function allowancePartitionsUsedThisMonth(
	db: Kysely<Database>,
	accountId: string,
	now: Date = new Date(),
): Promise<number> {
	const { start, end } = monthBounds(now);
	const row = await db
		.selectFrom("archive_fetches")
		.select((eb) => eb.fn.countAll<string>().as("count"))
		.where("account_id", "=", accountId)
		.where("via_allowance", "=", true)
		.where("charged_at", ">=", start)
		.where("charged_at", "<", end)
		.executeTakeFirst();
	return row ? Number(row.count) : 0;
}

/** Insert one charge-log row. Never updated after insert. */
export async function recordFetch(
	db: Kysely<Database>,
	record: ArchiveFetchRecord,
	now: Date = new Date(),
): Promise<void> {
	await db
		.insertInto("archive_fetches")
		.values({
			account_id: record.accountId,
			path: record.path,
			dataset: record.dataset,
			usd_micros: record.usdMicros.toString(),
			via_allowance: record.viaAllowance,
			charged_at: now,
		})
		.execute();
}
