import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { insertRequestLog, purgeRequestLog } from "./api-request-log.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
let accountId: string | undefined;

afterAll(async () => {
	if (!HAS_DB || !accountId) return;
	// ON DELETE CASCADE clears the log rows.
	await db.deleteFrom("accounts").where("id", "=", accountId).execute();
});

describe.skipIf(!HAS_DB)("api_request_log queries", () => {
	test("purge deletes only rows older than the cutoff", async () => {
		const acct = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountId = acct.id;
		const base = {
			request_id: null,
			account_id: acct.id,
			api_key_id: null,
			method: "GET",
			path: "/v1/index/events",
			path_template: "/v1/index/events",
			params_hash: null,
			cursor_hash: null,
			page_size: 10,
			rows: 3,
			status: 200,
			duration_ms: 12,
		};
		await insertRequestLog(db, {
			...base,
			created_at: new Date(Date.now() - 8 * 24 * 60 * 60_000),
		});
		await insertRequestLog(db, base);

		const deleted = await purgeRequestLog(
			db,
			new Date(Date.now() - 7 * 24 * 60 * 60_000),
		);
		expect(deleted).toBeGreaterThanOrEqual(1);

		const left = await db
			.selectFrom("api_request_log")
			.select("id")
			.where("account_id", "=", acct.id)
			.execute();
		expect(left).toHaveLength(1);
	});
});
