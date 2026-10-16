import { afterAll, describe, expect, test } from "bun:test";
import { insertRequestLog } from "@secondlayer/platform/db/queries/api-request-log";
import { getDb } from "@secondlayer/shared/db";
import { purgeExpiredRequestLog } from "./request-log-purge.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
let accountId: string | undefined;

afterAll(async () => {
	if (!HAS_DB || !accountId) return;
	await db.deleteFrom("accounts").where("id", "=", accountId).execute();
});

describe.skipIf(!HAS_DB)("purgeExpiredRequestLog", () => {
	test("deletes an 8-day-old row and keeps a 1-day-old row", async () => {
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
			path: "/v1/streams/events",
			path_template: "/v1/streams/events",
			params_hash: null,
			cursor_hash: null,
			page_size: null,
			rows: 0,
			status: 200,
			duration_ms: 5,
		};
		await insertRequestLog(db, {
			...base,
			status: 201,
			created_at: new Date(Date.now() - 8 * 24 * 60 * 60_000),
		});
		await insertRequestLog(db, {
			...base,
			status: 202,
			created_at: new Date(Date.now() - 24 * 60 * 60_000),
		});

		await purgeExpiredRequestLog();

		const left = await db
			.selectFrom("api_request_log")
			.select("status")
			.where("account_id", "=", acct.id)
			.execute();
		expect(left.map((r) => r.status)).toEqual([202]);
	});
});
