import type { Database, InsertApiRequestLogRow } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

export async function insertRequestLog(
	db: Kysely<Database>,
	row: InsertApiRequestLogRow,
): Promise<void> {
	await db.insertInto("api_request_log").values(row).execute();
}

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
