import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	READ_PATH_PREFIXES,
	failedRequestsByPath,
	getFailedRequest,
	insertFailedRequest,
	purgeFailedRequests,
} from "./api-failed-requests.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const accountIds: string[] = [];

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: true })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

function row(accountId: string, requestId: string, createdAt?: Date) {
	return {
		request_id: requestId,
		account_id: accountId,
		method: "GET",
		path: "/v1/index/ft-transfers",
		status: 404,
		code: "NOT_FOUND",
		message: "nope",
		query: { limit: "5" },
		origin: null,
		...(createdAt ? { created_at: createdAt } : {}),
	};
}

afterAll(async () => {
	if (!HAS_DB || accountIds.length === 0) return;
	// ON DELETE CASCADE clears the failed-request rows.
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

describe.skipIf(!HAS_DB)("api_failed_requests queries", () => {
	test("insert then get returns the row", async () => {
		const acct = await makeAccount();
		await insertFailedRequest(db, row(acct, `req_get_${acct}`));
		const got = await getFailedRequest(db, acct, `req_get_${acct}`);
		expect(got?.status).toBe(404);
		expect(got?.query).toEqual({ limit: "5" });
	});

	test("get with another account's id returns null", async () => {
		const owner = await makeAccount();
		const other = await makeAccount();
		await insertFailedRequest(db, row(owner, `req_iso_${owner}`));
		expect(await getFailedRequest(db, other, `req_iso_${owner}`)).toBeNull();
	});

	test("a duplicate insert is a no-op", async () => {
		const acct = await makeAccount();
		const id = `req_dup_${acct}`;
		await insertFailedRequest(db, row(acct, id));
		await insertFailedRequest(db, { ...row(acct, id), message: "second" });
		expect((await getFailedRequest(db, acct, id))?.message).toBe("nope");
	});

	test("purge deletes only rows older than the cutoff", async () => {
		const acct = await makeAccount();
		const old = new Date(Date.now() - 25 * 60 * 60_000);
		await insertFailedRequest(db, row(acct, `req_old_${acct}`, old));
		await insertFailedRequest(db, row(acct, `req_new_${acct}`));
		const deleted = await purgeFailedRequests(
			db,
			new Date(Date.now() - 24 * 60 * 60_000),
		);
		expect(deleted).toBeGreaterThanOrEqual(1);
		expect(await getFailedRequest(db, acct, `req_old_${acct}`)).toBeNull();
		expect(await getFailedRequest(db, acct, `req_new_${acct}`)).not.toBeNull();
	});
});

describe.skipIf(!HAS_DB)("failedRequestsByPath", () => {
	test("groups duplicates, respects since, scopes to the account", async () => {
		const acct = await makeAccount();
		const other = await makeAccount();
		const now = Date.now();
		const recent = new Date(now - 60_000);
		await insertFailedRequest(db, row(acct, `req_g1_${acct}`, recent));
		await insertFailedRequest(db, row(acct, `req_g2_${acct}`, recent));
		await insertFailedRequest(db, {
			...row(acct, `req_g3_${acct}`, recent),
			status: 500,
			code: "INTERNAL",
			path: "/v1/index/other",
		});
		await insertFailedRequest(
			db,
			row(acct, `req_g4_${acct}`, new Date(now - 48 * 3_600_000)),
		);
		await insertFailedRequest(db, row(other, `req_g5_${other}`, recent));

		const groups = await failedRequestsByPath(
			db,
			acct,
			new Date(now - 24 * 3_600_000),
		);
		expect(groups).toEqual([
			{
				status: 404,
				code: "NOT_FOUND",
				path: "/v1/index/ft-transfers",
				count: 2,
				last: recent.toISOString(),
			},
			{
				status: 500,
				code: "INTERNAL",
				path: "/v1/index/other",
				count: 1,
				last: recent.toISOString(),
			},
		]);
	});

	test("path prefixes keep only that surface's failures", async () => {
		const acct = await makeAccount();
		const recent = new Date(Date.now() - 60_000);
		for (const [id, path, status] of [
			["r1", "/v1/index/transactions", 400],
			["r2", "/v1/streams/events", 503],
			["r3", "/api/billing/topup", 400],
			["r4", "/api/subgraphs", 502],
		] as const) {
			await insertFailedRequest(db, {
				...row(acct, `req_${id}_${acct}`, recent),
				status,
				path,
			});
		}
		const reads = await failedRequestsByPath(
			db,
			acct,
			new Date(Date.now() - 3_600_000),
			READ_PATH_PREFIXES,
		);
		expect(reads.map((g) => g.path).sort()).toEqual([
			"/v1/index/transactions",
			"/v1/streams/events",
		]);
		const all = await failedRequestsByPath(
			db,
			acct,
			new Date(Date.now() - 3_600_000),
		);
		expect(all).toHaveLength(4);
	});
});
