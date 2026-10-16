import type { Database, InsertApiRequestLogRow } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

/**
 * 7-day log of account-attributed Index/Streams reads. The request-log
 * middleware writes (`insertRequestLog`); the worker purges
 * (`packages/worker/src/jobs/request-log-purge.ts`).
 */

export async function insertRequestLog(
	db: Kysely<Database>,
	row: InsertApiRequestLogRow,
): Promise<void> {
	await db.insertInto("api_request_log").values(row).execute();
}

/** Deletes rows created before `olderThan`; returns the deleted count. */
export async function purgeRequestLog(
	db: Kysely<Database>,
	olderThan: Date,
): Promise<number> {
	const res = await db
		.deleteFrom("api_request_log")
		.where("created_at", "<", olderThan)
		.executeTakeFirst();
	return Number(res.numDeletedRows);
}
