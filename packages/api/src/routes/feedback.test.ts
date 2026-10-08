import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb, jsonb } from "@secondlayer/shared/db";
import { Hono, type MiddlewareHandler } from "hono";
import { _resetRateLimitStoreForTests } from "../auth/rate-limit-store.ts";
import { createApiApp } from "../create-app.ts";
import { errorHandler } from "../middleware/error.ts";
import {
	FEEDBACK_KINDS,
	createFeedbackRouter,
	parseFeedback,
	parseIdempotencyKey,
} from "./feedback.ts";

function ok(body: Record<string, unknown>) {
	const parsed = parseFeedback(body);
	if (!("ok" in parsed)) throw new Error(`expected ok, got ${parsed.error}`);
	return parsed.ok;
}

function err(body: Record<string, unknown>) {
	const parsed = parseFeedback(body);
	if (!("error" in parsed)) throw new Error("expected error");
	return parsed.error;
}

describe("parseFeedback", () => {
	test("minimal body gives nulls for optional fields", () => {
		expect(ok({ intent: "list swaps" })).toEqual({
			intent: "list swaps",
			request_id: null,
			kind_hint: null,
			expected: null,
			evidence: null,
		});
	});

	test("intent is trimmed", () => {
		expect(ok({ intent: "  hello  " }).intent).toBe("hello");
	});

	test("blank or missing intent names the field", () => {
		expect(err({ intent: "   " })).toContain("intent is required");
		expect(err({})).toContain("intent is required");
	});

	test("intent over 2000 chars or non-string is refused", () => {
		expect(err({ intent: "a".repeat(2001) })).toContain("intent");
		expect(err({ intent: 5 })).toContain("intent");
		expect(ok({ intent: "a".repeat(2000) }).intent).toHaveLength(2000);
	});

	test("unknown top-level key is refused", () => {
		expect(err({ intent: "x", payload: {} })).toBe("unknown field: payload");
		expect(err({ intent: "x", attempted: {} })).toBe(
			"unknown field: attempted",
		);
	});

	test("kind_hint must be in the enum", () => {
		expect(err({ intent: "x", kind_hint: "nope" })).toContain("kind_hint");
		for (const kind of FEEDBACK_KINDS) {
			expect(ok({ intent: "x", kind_hint: kind }).kind_hint).toBe(kind);
		}
	});

	test("request_id must match the id format", () => {
		expect(err({ intent: "x", request_id: "has space1" })).toContain(
			"request_id",
		);
		expect(err({ intent: "x", request_id: "short12" })).toContain("request_id");
		expect(err({ intent: "x", request_id: 12345678 })).toContain("request_id");
		expect(ok({ intent: "x", request_id: "req_abc12345" }).request_id).toBe(
			"req_abc12345",
		);
	});

	test("expected must be an object under the size cap", () => {
		expect(err({ intent: "x", expected: [] })).toContain("expected");
		expect(err({ intent: "x", expected: { a: "b".repeat(4100) } })).toContain(
			"expected",
		);
		expect(ok({ intent: "x", expected: { rows: 3 } }).expected).toEqual({
			rows: 3,
		});
	});

	test("evidence is checked key by key", () => {
		expect(err({ intent: "x", evidence: { nope: "a" } })).toBe(
			"unknown evidence field: nope",
		);
		expect(err({ intent: "x", evidence: { block_height: -1 } })).toContain(
			"block_height",
		);
		expect(err({ intent: "x", evidence: { block_height: 1.5 } })).toContain(
			"block_height",
		);
		expect(
			err({ intent: "x", evidence: { tx_id: "a".repeat(129) } }),
		).toContain("tx_id");
		expect(
			ok({ intent: "x", evidence: { tx_id: "0xabc", block_height: 10 } })
				.evidence,
		).toEqual({ tx_id: "0xabc", block_height: 10 });
	});

	test("empty evidence object becomes null", () => {
		expect(ok({ intent: "x", evidence: {} }).evidence).toBeNull();
	});
});

describe("parseIdempotencyKey", () => {
	test("absent is null", () => {
		expect(parseIdempotencyKey(undefined)).toEqual({ ok: null });
	});
	test("129 chars is refused", () => {
		expect("error" in parseIdempotencyKey("a".repeat(129))).toBe(true);
	});
	test("a space is refused", () => {
		expect("error" in parseIdempotencyKey("has space")).toBe(true);
	});
	test("printable key is accepted", () => {
		expect(parseIdempotencyKey("retry-1")).toEqual({ ok: "retry-1" });
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const accountIds: string[] = [];

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: false })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

async function seedFailed(
	accountId: string,
	requestId: string,
	createdAt?: Date,
) {
	await db
		.insertInto("api_failed_requests")
		.values({
			request_id: requestId,
			account_id: accountId,
			method: "GET",
			path: "/v1/index/events",
			status: 400,
			code: "VALIDATION_ERROR",
			message: "unknown column",
			query: jsonb({ sender: "SP1" }),
			origin: "mcp",
			...(createdAt ? { created_at: createdAt } : {}),
		})
		.execute();
}

function appFor(accountId?: string) {
	const a = new Hono();
	const setAccountId: MiddlewareHandler = async (c, next) => {
		if (accountId) c.set("accountId", accountId);
		await next();
	};
	a.use("*", setAccountId);
	a.onError(errorHandler);
	a.route("/v1/feedback", createFeedbackRouter());
	return a;
}

function post(app: Hono, body: unknown, headers: Record<string, string> = {}) {
	return app.request("/v1/feedback", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

async function read(res: Response): Promise<Record<string, unknown>> {
	return (await res.json()) as Record<string, unknown>;
}

async function ticketsFor(accountId: string) {
	return db
		.selectFrom("feedback_tickets")
		.selectAll()
		.where("account_id", "=", accountId)
		.execute();
}

let requestCounter = 0;
function newRequestId() {
	requestCounter += 1;
	return `req_test_${Date.now()}_${requestCounter}`;
}

afterAll(async () => {
	if (!HAS_DB || accountIds.length === 0) return;
	await db
		.deleteFrom("feedback_tickets")
		.where("account_id", "in", accountIds)
		.execute();
	await db
		.deleteFrom("api_failed_requests")
		.where("account_id", "in", accountIds)
		.execute();
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

describe.skipIf(!HAS_DB)("POST /v1/feedback", () => {
	beforeEach(async () => {
		await _resetRateLimitStoreForTests();
	});

	test("no account in context is a 401", async () => {
		const res = await post(appFor(), { intent: "x" });
		expect(res.status).toBe(401);
		expect((await read(res)).code).toBe("AUTHENTICATION_ERROR");
	});

	test("valid body without request_id is accepted and stored as new", async () => {
		const accountId = await makeAccount();
		const res = await post(appFor(accountId), { intent: "list swaps" });
		expect(res.status).toBe(202);
		const json = await read(res);
		expect(json.status).toBe("accepted");
		expect(json.request_matched).toBe(false);
		const [row] = await ticketsFor(accountId);
		expect(row?.id).toBe(json.id as string);
		expect(row?.status).toBe("new");
		expect(row?.attempted).toBeNull();
		expect(row?.origin).toBe("api");
	});

	test("x-sl-origin is stored only for known values", async () => {
		const accountId = await makeAccount();
		const app = appFor(accountId);
		await post(app, { intent: "a" }, { "x-sl-origin": "mcp" });
		await post(app, { intent: "b" }, { "x-sl-origin": "evil" });
		const rows = await ticketsFor(accountId);
		const byIntent = Object.fromEntries(rows.map((r) => [r.intent, r.origin]));
		expect(byIntent).toEqual({ a: "mcp", b: "api" });
	});

	test("same-account request_id attaches the server's record", async () => {
		const accountId = await makeAccount();
		const requestId = newRequestId();
		await seedFailed(accountId, requestId);
		const res = await post(appFor(accountId), {
			intent: "filter by sender",
			request_id: requestId,
		});
		expect(res.status).toBe(202);
		expect((await read(res)).request_matched).toBe(true);
		const [row] = await ticketsFor(accountId);
		expect(row?.request_id).toBe(requestId);
		expect(row?.attempted).toMatchObject({
			method: "GET",
			path: "/v1/index/events",
			status: 400,
			code: "VALIDATION_ERROR",
			message: "unknown column",
			query: { sender: "SP1" },
			origin: "mcp",
		});
	});

	test("another account's request_id looks the same as an unknown one", async () => {
		const owner = await makeAccount();
		const other = await makeAccount();
		const requestId = newRequestId();
		await seedFailed(owner, requestId);
		const res = await post(appFor(other), {
			intent: "x",
			request_id: requestId,
		});
		expect(res.status).toBe(202);
		const json = await read(res);
		expect(json.request_matched).toBe(false);
		const [row] = await ticketsFor(other);
		expect(row?.attempted).toBeNull();
	});

	test("request_id older than 24h has no attempted record", async () => {
		const accountId = await makeAccount();
		const requestId = newRequestId();
		await seedFailed(
			accountId,
			requestId,
			new Date(Date.now() - 25 * 3600_000),
		);
		const res = await post(appFor(accountId), {
			intent: "x",
			request_id: requestId,
		});
		expect(res.status).toBe(202);
		expect((await read(res)).request_matched).toBe(false);
		const [row] = await ticketsFor(accountId);
		expect(row?.attempted).toBeNull();
	});

	test("repeat Idempotency-Key returns the first id and leaves the row alone", async () => {
		const accountId = await makeAccount();
		const requestId = newRequestId();
		await seedFailed(accountId, requestId);
		const app = appFor(accountId);
		const first = await read(
			await post(
				app,
				{ intent: "first", request_id: requestId },
				{ "idempotency-key": "retry-1" },
			),
		);
		const second = await post(
			app,
			{ intent: "second" },
			{ "idempotency-key": "retry-1" },
		);
		expect(second.status).toBe(202);
		const json = await read(second);
		expect(json).toEqual({
			id: first.id,
			status: "duplicate",
			request_matched: true,
		});
		const rows = await ticketsFor(accountId);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.intent).toBe("first");
	});

	test("same Idempotency-Key from two accounts stores two tickets", async () => {
		const a = await makeAccount();
		const b = await makeAccount();
		const headers = { "idempotency-key": "shared-key" };
		const ra = await read(await post(appFor(a), { intent: "x" }, headers));
		const rb = await read(await post(appFor(b), { intent: "x" }, headers));
		expect(ra.status).toBe("accepted");
		expect(rb.status).toBe("accepted");
		expect(ra.id).not.toBe(rb.id);
	});

	test("without a key, repeats each store a ticket", async () => {
		const accountId = await makeAccount();
		const app = appFor(accountId);
		await post(app, { intent: "x" });
		await post(app, { intent: "x" });
		expect(await ticketsFor(accountId)).toHaveLength(2);
	});

	test("malformed JSON is a 400 INVALID_JSON", async () => {
		const accountId = await makeAccount();
		const res = await post(appFor(accountId), "{nope");
		expect(res.status).toBe(400);
		expect((await read(res)).code).toBe("INVALID_JSON");
	});

	test("non-object body is a 400 VALIDATION_ERROR", async () => {
		const accountId = await makeAccount();
		const res = await post(appFor(accountId), "[]");
		expect(res.status).toBe(400);
		expect((await read(res)).code).toBe("VALIDATION_ERROR");
	});

	test("body over 16 KB is a 400 VALIDATION_ERROR", async () => {
		const accountId = await makeAccount();
		const res = await post(appFor(accountId), {
			intent: "x",
			expected: { pad: "a".repeat(17_000) },
		});
		expect(res.status).toBe(400);
		expect((await read(res)).code).toBe("VALIDATION_ERROR");
	});

	test("unknown field is a 400 VALIDATION_ERROR", async () => {
		const accountId = await makeAccount();
		const res = await post(appFor(accountId), { intent: "x", attempted: {} });
		expect(res.status).toBe(400);
		expect((await read(res)).code).toBe("VALIDATION_ERROR");
	});

	test("31st request in a minute from one account is a 429", async () => {
		const accountId = await makeAccount();
		const app = appFor(accountId);
		for (let i = 0; i < 30; i++) {
			expect((await post(app, { intent: "x" })).status).toBe(202);
		}
		const res = await post(app, { intent: "x" });
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).toBeTruthy();
	});
});

describe.skipIf(!HAS_DB)("mounted on the app", () => {
	let prevDevMode: string | undefined;
	let prevMode: string | undefined;
	beforeEach(async () => {
		prevDevMode = process.env.DEV_MODE;
		prevMode = process.env.INSTANCE_MODE;
		process.env.DEV_MODE = "false";
		await _resetRateLimitStoreForTests();
	});
	afterEach(() => {
		if (prevDevMode === undefined) process.env.DEV_MODE = undefined;
		else process.env.DEV_MODE = prevDevMode;
		if (prevMode === undefined) process.env.INSTANCE_MODE = undefined;
		else process.env.INSTANCE_MODE = prevMode;
	});

	test("platform without a bearer is a 401", async () => {
		process.env.INSTANCE_MODE = "platform";
		const app = createApiApp("platform");
		const res = await app.request("/v1/feedback", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ intent: "x" }),
		});
		expect(res.status).toBe(401);
	});

	test("platform text/plain is a 415 before auth", async () => {
		process.env.INSTANCE_MODE = "platform";
		const app = createApiApp("platform");
		const res = await app.request("/v1/feedback", {
			method: "POST",
			headers: { "content-type": "text/plain" },
			body: "x",
		});
		expect(res.status).toBe(415);
		expect((await read(res)).code).toBe("UNSUPPORTED_MEDIA_TYPE");
	});

	test("oss has no /v1/feedback", async () => {
		process.env.INSTANCE_MODE = "oss";
		const app = createApiApp("oss");
		const res = await app.request("/v1/feedback", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ intent: "x" }),
		});
		expect(res.status).toBe(404);
	});

	test("discovery lists feedback on hosted only", async () => {
		const names = async (mode: "platform" | "oss") => {
			process.env.INSTANCE_MODE = mode;
			const res = await createApiApp(mode).request("/v1");
			return ((await read(res)).surfaces as { name: string }[]).map(
				(s) => s.name,
			);
		};
		expect(await names("platform")).toContain("feedback");
		expect(await names("oss")).not.toContain("feedback");
	});
});
