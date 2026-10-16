import { describe, expect, test } from "bun:test";
import type { InsertApiRequestLogRow } from "@secondlayer/shared/db";
import { ValidationError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { errorHandler } from "./error.ts";
import { requestId } from "./request-id.ts";
import { pathTemplate, queryFingerprint, requestLog } from "./request-log.ts";

const PRINCIPAL = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const HASH64 =
	"82fd0c5d9a7b1e3f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8ddc";

describe("pathTemplate", () => {
	test("replaces digits, 0x hex, long hex and principals", () => {
		expect(pathTemplate("/v1/blocks/12345")).toBe("/v1/blocks/:param");
		expect(pathTemplate("/v1/tx/0xabc123")).toBe("/v1/tx/:param");
		expect(pathTemplate(`/v1/proofs/marf/${HASH64}`)).toBe(
			"/v1/proofs/marf/:param",
		);
		expect(pathTemplate(`/v1/index/balances/${PRINCIPAL}`)).toBe(
			"/v1/index/balances/:param",
		);
		expect(pathTemplate(`/v1/index/contracts/${PRINCIPAL}.my-token`)).toBe(
			"/v1/index/contracts/:param",
		);
	});

	test("leaves plain segments unchanged", () => {
		expect(pathTemplate("/v1/index/events")).toBe("/v1/index/events");
		expect(pathTemplate("/v1/streams/events/stream")).toBe(
			"/v1/streams/events/stream",
		);
	});
});

describe("queryFingerprint", () => {
	test("same filters with different cursors share paramsHash", () => {
		const a = queryFingerprint(new URL("http://x/p?type=ft&cursor=1:0"));
		const b = queryFingerprint(new URL("http://x/p?type=ft&cursor=2:5"));
		expect(a.paramsHash).toBe(b.paramsHash);
		expect(a.cursorHash).not.toBe(b.cursorHash);
		expect(a.cursorHash).toHaveLength(16);
	});

	test("key order does not change paramsHash", () => {
		const a = queryFingerprint(new URL("http://x/p?a=1&b=2"));
		const b = queryFingerprint(new URL("http://x/p?b=2&a=1"));
		expect(a.paramsHash).toBe(b.paramsHash);
	});

	test("no query yields all nulls", () => {
		expect(queryFingerprint(new URL("http://x/p"))).toEqual({
			paramsHash: null,
			cursorHash: null,
			pageSize: null,
		});
	});

	test("a cursor alone leaves paramsHash null", () => {
		const f = queryFingerprint(new URL("http://x/p?cursor=1:0"));
		expect(f.paramsHash).toBeNull();
		expect(f.cursorHash).not.toBeNull();
	});

	test("limit parses to pageSize; junk is null", () => {
		expect(queryFingerprint(new URL("http://x/p?limit=50")).pageSize).toBe(50);
		expect(
			queryFingerprint(new URL("http://x/p?limit=abc")).pageSize,
		).toBeNull();
		expect(queryFingerprint(new URL("http://x/p?limit=0")).pageSize).toBeNull();
	});
});

type Tenant = { account_id?: string; api_key_id?: string; tier: string };

function appFor(
	tenant: Tenant | undefined,
	record: (row: InsertApiRequestLogRow) => Promise<void>,
) {
	const app = new Hono<{ Variables: Record<string, unknown> }>();
	app.onError(errorHandler);
	app.use("*", requestId());
	app.use("*", requestLog({ record }));
	app.get("/v1/index/events", (c) => {
		if (tenant) c.set("indexTenant", tenant);
		c.set("rowsServed", 7);
		return c.json({ ok: true });
	});
	app.get("/v1/index/boom", (c) => {
		if (tenant) c.set("indexTenant", tenant);
		throw new ValidationError("bad");
	});
	return app;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("requestLog middleware", () => {
	const free: Tenant = {
		account_id: "acct-1",
		api_key_id: "key-1",
		tier: "free",
	};

	test("records one row with the right fields", async () => {
		const rows: InsertApiRequestLogRow[] = [];
		const app = appFor(free, async (r) => {
			rows.push(r);
		});
		const res = await app.request("/v1/index/events?limit=25&cursor=9:1");
		expect(res.status).toBe(200);
		await flush();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			account_id: "acct-1",
			api_key_id: "key-1",
			method: "GET",
			path: "/v1/index/events",
			path_template: "/v1/index/events",
			page_size: 25,
			rows: 7,
			status: 200,
		});
		expect(rows[0]?.cursor_hash).toHaveLength(16);
		expect(rows[0]?.params_hash).toHaveLength(16);
		expect(rows[0]?.request_id).toBeTruthy();
	});

	test("records the error status when a handler throws", async () => {
		const rows: InsertApiRequestLogRow[] = [];
		const app = appFor(free, async (r) => {
			rows.push(r);
		});
		const res = await app.request("/v1/index/boom");
		expect(res.status).toBeGreaterThanOrEqual(400);
		await flush();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe(res.status);
		expect(rows[0]?.rows).toBeNull();
	});

	test("skips internal tier", async () => {
		const rows: InsertApiRequestLogRow[] = [];
		const app = appFor({ ...free, tier: "internal" }, async (r) => {
			rows.push(r);
		});
		await app.request("/v1/index/events");
		await flush();
		expect(rows).toHaveLength(0);
	});

	test("skips requests with no tenant or no account", async () => {
		const rows: InsertApiRequestLogRow[] = [];
		const record = async (r: InsertApiRequestLogRow) => {
			rows.push(r);
		};
		await appFor(undefined, record).request("/v1/index/events");
		await appFor({ tier: "free" }, record).request("/v1/index/events");
		await flush();
		expect(rows).toHaveLength(0);
	});

	test("a rejecting record never affects the response", async () => {
		const app = appFor(free, async () => {
			throw new Error("db down");
		});
		const res = await app.request("/v1/index/events");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		await flush();
	});
});
