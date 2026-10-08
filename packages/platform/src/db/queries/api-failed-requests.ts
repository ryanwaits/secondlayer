import type {
	ApiFailedRequest,
	Database,
	InsertApiFailedRequest,
} from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

/**
 * 24h record of failed hosted API requests. The error-envelope middleware
 * writes (`insertFailedRequest`), feedback reports read back the server-side
 * evidence by `request_id` (`getFailedRequest`), and the worker purges
 * (`packages/worker/src/jobs/failed-requests-purge.ts`).
 */

/** Idempotent on `request_id`: a duplicate insert is a no-op. */
export async function insertFailedRequest(
	db: Kysely<Database>,
	row: InsertApiFailedRequest,
): Promise<void> {
	await db
		.insertInto("api_failed_requests")
		.values(row)
		.onConflict((oc) => oc.column("request_id").doNothing())
		.execute();
}

/** Always scoped to `accountId`: never returns another account's row. */
export async function getFailedRequest(
	db: Kysely<Database>,
	accountId: string,
	requestId: string,
): Promise<ApiFailedRequest | null> {
	const row = await db
		.selectFrom("api_failed_requests")
		.selectAll()
		.where("account_id", "=", accountId)
		.where("request_id", "=", requestId)
		.executeTakeFirst();
	return row ?? null;
}

/** Deletes rows created before `olderThan`; returns the deleted count. */
export async function purgeFailedRequests(
	db: Kysely<Database>,
	olderThan: Date,
): Promise<number> {
	const res = await db
		.deleteFrom("api_failed_requests")
		.where("created_at", "<", olderThan)
		.executeTakeFirst();
	return Number(res.numDeletedRows);
}
