import type {
	ApiFailedRequest,
	Database,
	InsertApiFailedRequest,
} from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

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

export type FailedRequestGroup = {
	status: number;
	code: string;
	path: string;
	count: number;
	last: string;
};

export const READ_PATH_PREFIXES: readonly string[] = [
	"/v1/index/",
	"/v1/streams/",
];

export async function failedRequestsByPath(
	db: Kysely<Database>,
	accountId: string,
	since: Date,
	pathPrefixes?: readonly string[],
): Promise<FailedRequestGroup[]> {
	const rows = await db
		.selectFrom("api_failed_requests")
		.select((eb) => [
			"status",
			"code",
			"path",
			eb.fn.countAll<string>().as("count"),
			eb.fn.max("created_at").as("last"),
		])
		.where("account_id", "=", accountId)
		.where("created_at", ">=", since)
		.$if(pathPrefixes !== undefined, (qb) =>
			qb.where((eb) =>
				eb.or(
					(pathPrefixes ?? []).map((prefix) =>
						eb("path", "like", `${prefix}%`),
					),
				),
			),
		)
		.groupBy(["status", "code", "path"])
		.orderBy("count", "desc")
		.orderBy("path")
		.limit(20)
		.execute();
	return rows.map((row) => ({
		status: row.status,
		code: row.code,
		path: row.path,
		count: Number(row.count),
		last: new Date(row.last as Date).toISOString(),
	}));
}
