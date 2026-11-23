import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

export type ArchiveFetchRecord = {
	accountId: string;
	path: string;
	dataset: string;
	usdMicros: bigint;
	viaAllowance: boolean;
};

const RE_ISSUE_WINDOW_MS = 24 * 60 * 60 * 1000;

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

function monthBounds(now: Date): { start: Date; end: Date } {
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const end = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
	);
	return { start, end };
}

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
