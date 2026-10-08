import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getFailedRequest } from "@secondlayer/platform/db/queries/api-failed-requests";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import internalFailedRequestsRouter, {
	MAX_FAILED_REQUEST_BATCH,
} from "./internal-failed-requests.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const accountIds: string[] = [];

let accountId: string;
let prevKey: string | undefined;

beforeEach(async () => {
	prevKey = process.env.WORKLOAD_HOST_KEY;
	process.env.WORKLOAD_HOST_KEY = "test-workload-host-key";
	if (!HAS_DB) return;
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: true })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountId = row.id;
	accountIds.push(row.id);
});

afterEach(() => {
	if (prevKey === undefined) {
		delete process.env.WORKLOAD_HOST_KEY;
	} else process.env.WORKLOAD_HOST_KEY = prevKey;
});

afterAll(async () => {
	if (!HAS_DB || accountIds.length === 0) return;
	await db
		.deleteFrom("api_failed_requests")
		.where("account_id", "in", accountIds)
		.execute();
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

function app() {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/internal/failed-requests", internalFailedRequestsRouter);
	return a;
}

function post(body: unknown, auth: string | null = "test-workload-host-key") {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (auth !== null) headers.authorization = `Bearer ${auth}`;
	return app().request("/internal/failed-requests", {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
}

let seq = 0;
function item(overrides: Record<string, unknown> = {}) {
	seq++;
	return {
		request_id: `req_ingest_${Date.now()}_${seq}`,
		account_id: accountId,
		method: "GET",
		path: "/v1/subgraphs/s/t",
		status: 400,
		code: "VALIDATION_ERROR",
		message: "Unknown column: foo",
		query: { where: "foo" },
		origin: "mcp",
		...overrides,
	};
}

describe.skipIf(!HAS_DB)("POST /internal/failed-requests", () => {
	test("missing Authorization is 401", async () => {
		expect((await post({ items: [item()] }, null)).status).toBe(401);
	});

	test("wrong key is 401", async () => {
		expect((await post({ items: [item()] }, "nope")).status).toBe(401);
	});

	test("unset WORKLOAD_HOST_KEY is 401 even with a bearer", async () => {
		delete process.env.WORKLOAD_HOST_KEY;
		expect((await post({ items: [item()] })).status).toBe(401);
	});

	test("empty items is 400", async () => {
		expect((await post({ items: [] })).status).toBe(400);
	});

	test("over the batch cap is 413", async () => {
		const items = Array.from({ length: MAX_FAILED_REQUEST_BATCH + 1 }, () =>
			item(),
		);
		expect((await post({ items })).status).toBe(413);
	});

	test.each([
		["request_id", { request_id: "<x>" }],
		["account_id", { account_id: "acct_1" }],
		["status", { status: 200 }],
		["query", { query: { big: "x".repeat(3000) } }],
		["origin", { origin: "evil" }],
	])("invalid %s is 400 naming the field", async (field, override) => {
		const res = await post({ items: [item(override)] });
		expect(res.status).toBe(400);
		expect(JSON.stringify(await res.json())).toContain(`items[0].${field}`);
	});

	test("valid batch is stored and readable by request id", async () => {
		const a = item();
		const b = item({ origin: null });
		const res = await post({ items: [a, b] });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ accepted: 2, skipped: 0 });
		const row = await getFailedRequest(db, accountId, a.request_id);
		expect(row?.path).toBe("/v1/subgraphs/s/t");
		expect(row?.origin).toBe("mcp");
		expect(await getFailedRequest(db, accountId, b.request_id)).not.toBeNull();
	});

	test("a duplicate request_id is a silent no-op", async () => {
		const items = [item(), item()];
		await post({ items });
		const res = await post({ items });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ accepted: 2, skipped: 0 });
		const rows = await db
			.selectFrom("api_failed_requests")
			.select("request_id")
			.where("account_id", "=", accountId)
			.execute();
		expect(rows.length).toBe(2);
	});

	test("an unknown account is skipped, not an error", async () => {
		const ghost = item({
			account_id: "00000000-0000-4000-8000-000000000000",
		});
		const res = await post({ items: [ghost] });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ accepted: 0, skipped: 1 });
		const rows = await db
			.selectFrom("api_failed_requests")
			.select("request_id")
			.where("request_id", "=", ghost.request_id)
			.execute();
		expect(rows.length).toBe(0);
	});

	test("message is truncated to 200 chars", async () => {
		const a = item({ message: "m".repeat(500) });
		await post({ items: [a] });
		const row = await getFailedRequest(db, accountId, a.request_id);
		expect(row?.message.length).toBe(200);
	});
});
