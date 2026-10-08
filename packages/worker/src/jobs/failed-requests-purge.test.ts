import { afterAll, describe, expect, test } from "bun:test";
import {
	getFailedRequest,
	insertFailedRequest,
} from "@secondlayer/platform/db/queries/api-failed-requests";
import { getDb } from "@secondlayer/shared/db";
import { purgeExpiredFailedRequests } from "./failed-requests-purge.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
let accountId: string | undefined;

afterAll(async () => {
	if (!HAS_DB || !accountId) return;
	await db.deleteFrom("accounts").where("id", "=", accountId).execute();
});

describe.skipIf(!HAS_DB)("purgeExpiredFailedRequests", () => {
	test("deletes a 25h-old row and keeps a 1h-old row", async () => {
		const acct = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountId = acct.id;
		const base = {
			account_id: acct.id,
			method: "GET",
			path: "/v1/streams/events",
			status: 400,
			code: "VALIDATION_ERROR",
			message: "bad",
			query: {},
			origin: null,
		};
		await insertFailedRequest(db, {
			...base,
			request_id: `req_purge_old_${acct.id}`,
			created_at: new Date(Date.now() - 25 * 60 * 60_000),
		});
		await insertFailedRequest(db, {
			...base,
			request_id: `req_purge_new_${acct.id}`,
			created_at: new Date(Date.now() - 60 * 60_000),
		});

		await purgeExpiredFailedRequests();

		expect(
			await getFailedRequest(db, acct.id, `req_purge_old_${acct.id}`),
		).toBeNull();
		expect(
			await getFailedRequest(db, acct.id, `req_purge_new_${acct.id}`),
		).not.toBeNull();
	});
});
