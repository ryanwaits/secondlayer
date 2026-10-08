import { describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import type { InstanceMode } from "@secondlayer/shared/mode";
import { Hono } from "hono";
import { createApiApp } from "../create-app.ts";
import {
	type FailedRequestRecord,
	errorEnvelope,
	redactQuery,
	resolveAccountId,
} from "./error-envelope.ts";
import { errorHandler } from "./error.ts";
import { requestId } from "./request-id.ts";

const GITHUB = "https://github.com/ryanwaits/secondlayer/issues/new";

function app(
	mode: InstanceMode,
	record?: (row: FailedRequestRecord) => Promise<void>,
	preset?: (c: import("hono").Context) => void,
) {
	const hono = new Hono();
	hono.onError(errorHandler);
	hono.notFound((c) =>
		c.json({ error: "Not Found", code: "NOT_FOUND", path: c.req.path }, 404),
	);
	hono.use("*", requestId());
	hono.use("*", errorEnvelope({ mode, record }));
	if (preset) {
		hono.use("*", async (c, next) => {
			preset(c);
			await next();
		});
	}
	hono.get("/ok", (c) => c.json({ ok: true }));
	hono.get("/validation", () => {
		throw new ValidationError("bad");
	});
	hono.get("/nf", (c) => c.json({ error: "Key not found" }, 404));
	hono.get("/conflict", (c) => c.json({ error: "x" }, 409));
	hono.get("/gone", (c) => c.json({ error: "x" }, 410));
	hono.get("/bad-gateway", (c) => c.json({ error: "x" }, 502));
	hono.get("/unavailable", (c) => c.json({ error: "x" }, 503));
	hono.get("/teapot", (c) => c.json({ error: "x" }, 418));
	hono.get("/limited", (c) => c.json({ error: "slow down" }, 429));
	hono.get("/text", (c) => c.text("nope", 500));
	hono.get("/boom", () => {
		throw new Error("boom");
	});
	hono.get("/coded", (c) =>
		c.json(
			{ error: "x", code: "TABLE_NOT_FOUND", details: { table: "t" } },
			404,
		),
	);
	hono.get("/long", (c) => c.json({ error: "e".repeat(500) }, 400));
	return hono;
}

async function json(res: Response) {
	return (await res.json()) as Record<string, unknown>;
}

describe("request id header", () => {
	test("is set on 2xx with the body untouched", async () => {
		const res = await app("oss").request("/ok");
		expect(res.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{24}$/);
		expect(await json(res)).toEqual({ ok: true });
	});

	test("echoes a well-formed incoming id", async () => {
		const res = await app("oss").request("/nf", {
			headers: { "X-Request-Id": "abcdef12-ok" },
		});
		expect(res.headers.get("x-request-id")).toBe("abcdef12-ok");
		expect((await json(res)).request_id).toBe("abcdef12-ok");
	});

	test("replaces a malformed incoming id", async () => {
		const res = await app("oss").request("/nf", {
			headers: { "X-Request-Id": "<script>" },
		});
		expect(res.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{24}$/);
	});
});

describe("error envelope", () => {
	test("thrown ValidationError gets request_id, code and oss feedback", async () => {
		const res = await app("oss").request("/validation");
		const body = await json(res);
		expect(res.status).toBe(400);
		expect(body.code).toBe("VALIDATION_ERROR");
		expect(body.request_id).toBe(res.headers.get("x-request-id") as string);
		expect(body.feedback).toEqual({ url: GITHUB });
	});

	test("platform points feedback at /v1/feedback", async () => {
		const body = await json(await app("platform").request("/nf"));
		expect(body.feedback).toEqual({ url: "/v1/feedback" });
	});

	test.each([
		["/nf", "NOT_FOUND"],
		["/conflict", "CONFLICT"],
		["/gone", "GONE"],
		["/bad-gateway", "UPSTREAM_ERROR"],
		["/unavailable", "SERVICE_UNAVAILABLE"],
		["/teapot", "HTTP_ERROR"],
		["/limited", "RATE_LIMIT_ERROR"],
		["/boom", "INTERNAL_ERROR"],
	])("%s defaults code to %s", async (path, code) => {
		const body = await json(await app("oss").request(path));
		expect(body.code).toBe(code);
		expect(typeof body.request_id).toBe("string");
	});

	test("existing code and details are preserved verbatim", async () => {
		const body = await json(await app("oss").request("/coded"));
		expect(body.code).toBe("TABLE_NOT_FOUND");
		expect(body.details).toEqual({ table: "t" });
	});

	test("non-JSON errors are untouched but still carry the header", async () => {
		const res = await app("oss").request("/text");
		expect(await res.text()).toBe("nope");
		expect(res.headers.get("x-request-id")).toBeTruthy();
	});

	test("unknown route 404 carries path, request_id and feedback", async () => {
		const res = await app("oss").request("/missing");
		const body = await json(res);
		expect(res.status).toBe(404);
		expect(body.code).toBe("NOT_FOUND");
		expect(body.path).toBe("/missing");
		expect(body.request_id).toBe(res.headers.get("x-request-id") as string);
		expect(body.feedback).toEqual({ url: GITHUB });
	});

	test("content-length, if present, matches the rewritten body", async () => {
		const res = await app("oss").request("/nf");
		const len = res.headers.get("content-length");
		const bytes = new TextEncoder().encode(await res.text()).length;
		if (len !== null) expect(Number(len)).toBe(bytes);
	});

	test("real app: unknown route under oss", async () => {
		const res = await createApiApp("oss").request("/definitely-not-a-route");
		const body = await json(res);
		expect(res.status).toBe(404);
		expect(body.request_id).toBe(res.headers.get("x-request-id") as string);
		expect(body.code).toBe("NOT_FOUND");
		expect(body.feedback).toEqual({ url: GITHUB });
	});
});

describe("failed-request recording", () => {
	function recorder() {
		const rows: FailedRequestRecord[] = [];
		return {
			rows,
			record: async (row: FailedRequestRecord) => {
				rows.push(row);
			},
		};
	}

	test("platform + accountId records one row with a capped message", async () => {
		const r = recorder();
		const a = app("platform", r.record, (c) => c.set("accountId", "acct-1"));
		const res = await a.request("/long");
		expect(res.status).toBe(400);
		expect(r.rows).toHaveLength(1);
		expect(r.rows[0]).toMatchObject({
			account_id: "acct-1",
			method: "GET",
			path: "/long",
			status: 400,
			code: "VALIDATION_ERROR",
			origin: null,
		});
		expect(r.rows[0]?.message.length).toBe(200);
		expect(r.rows[0]?.request_id).toBe(
			res.headers.get("x-request-id") as string,
		);
	});

	test("unknown route records code NOT_FOUND", async () => {
		const r = recorder();
		const a = app("platform", r.record, (c) => c.set("accountId", "acct-1"));
		await a.request("/missing");
		expect(r.rows[0]?.code).toBe("NOT_FOUND");
	});

	test("indexTenant account is recorded", async () => {
		const r = recorder();
		const a = app("platform", r.record, (c) =>
			c.set("indexTenant", { account_id: "acct-2" }),
		);
		await a.request("/nf");
		expect(r.rows[0]?.account_id).toBe("acct-2");
	});

	test("no resolved account records nothing", async () => {
		const r = recorder();
		await app("platform", r.record).request("/nf");
		expect(r.rows).toHaveLength(0);
	});

	test("429 is never recorded", async () => {
		const r = recorder();
		const a = app("platform", r.record, (c) => c.set("accountId", "acct-1"));
		await a.request("/limited");
		expect(r.rows).toHaveLength(0);
	});

	test("oss never records", async () => {
		const r = recorder();
		const a = app("oss", r.record, (c) => c.set("accountId", "acct-1"));
		await a.request("/nf");
		expect(r.rows).toHaveLength(0);
	});

	test("sensitive query keys are dropped and origin is lowercased", async () => {
		const r = recorder();
		const a = app("platform", r.record, (c) => c.set("accountId", "acct-1"));
		await a.request("/nf?token=abc&limit=5", {
			headers: { "x-sl-origin": "MCP" },
		});
		expect(r.rows[0]?.query).toEqual({ limit: "5" });
		expect(r.rows[0]?.origin).toBe("mcp");
	});

	test("a 3 KB query is stored as a truncated key list", async () => {
		const r = recorder();
		const a = app("platform", r.record, (c) => c.set("accountId", "acct-1"));
		const qs = Array.from({ length: 15 }, (_, i) => `k${i}=${"v".repeat(200)}`);
		await a.request(`/nf?${qs.join("&")}`);
		expect(r.rows[0]?.query._truncated).toBe(true);
		expect((r.rows[0]?.query.keys as string[]).length).toBe(15);
	});

	test("a rejecting or throwing recorder still returns the normal body", async () => {
		for (const record of [
			async () => {
				throw new Error("db down");
			},
			() => {
				throw new Error("sync boom");
			},
		]) {
			const a = app("platform", record as never, (c) =>
				c.set("accountId", "acct-1"),
			);
			const res = await a.request("/nf");
			expect(res.status).toBe(404);
			expect((await json(res)).code).toBe("NOT_FOUND");
		}
	});

	test("does not await a slow recorder", async () => {
		const a = app(
			"platform",
			() => new Promise<void>(() => {}),
			(c) => c.set("accountId", "acct-1"),
		);
		const res = await a.request("/nf");
		expect(res.status).toBe(404);
	});
});

describe("helpers", () => {
	test("redactQuery re-export drops sensitive keys", () => {
		expect(redactQuery(new URLSearchParams("secret=1&a=2"))).toEqual({
			a: "2",
		});
	});

	test("resolveAccountId prefers accountId, then index, then streams tenant", async () => {
		const seen: (string | undefined)[] = [];
		const hono = new Hono<{ Variables: Record<string, unknown> }>();
		hono.get("/a", (c) => {
			c.set("accountId", "A");
			c.set("indexTenant", { account_id: "I" });
			seen.push(resolveAccountId(c));
			return c.text("");
		});
		hono.get("/s", (c) => {
			c.set("streamsTenant", { account_id: "S" });
			seen.push(resolveAccountId(c));
			return c.text("");
		});
		hono.get("/none", (c) => {
			c.set("indexTenant", {});
			seen.push(resolveAccountId(c));
			return c.text("");
		});
		await hono.request("/a");
		await hono.request("/s");
		await hono.request("/none");
		expect(seen).toEqual(["A", "S", undefined]);
	});
});
