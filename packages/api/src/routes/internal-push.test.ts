import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import internalPushRouter from "./internal-push.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const accountIds: string[] = [];

const KEY = "test-workload-host-key";
let prevKey: string | undefined;

beforeEach(() => {
	prevKey = process.env.WORKLOAD_HOST_KEY;
	process.env.WORKLOAD_HOST_KEY = KEY;
});

afterEach(() => {
	if (prevKey === undefined) delete process.env.WORKLOAD_HOST_KEY;
	else process.env.WORKLOAD_HOST_KEY = prevKey;
});

afterAll(async () => {
	if (!HAS_DB || accountIds.length === 0) return;
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: true })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

function post(body: unknown, key: string | null = KEY) {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/internal/push", internalPushRouter);
	return a.request("/internal/push", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(key ? { authorization: `Bearer ${key}` } : {}),
		},
		body: JSON.stringify(body),
	});
}

type Counts = { sent: number; duplicate: number; skipped: number };

const stopped = {
	subgraph: "sbtc-flows",
	reason: "stalled",
	height: 1204,
	lastError: null,
};
const finishedAt = "2026-10-18T10:00:00.000Z";
const replay = {
	replayId: "rp_1",
	webhookId: "wh_1",
	webhookName: "sbtc-deposits",
	finishedAt,
	delivered: 3790,
	gaveUp: 22,
	total: 3812,
};
const base = (accountId: string) => ({
	accountId,
	observedAt: new Date().toISOString(),
});
const claimed = async (acct: string) =>
	(
		await db
			.selectFrom("push_sent")
			.select("key")
			.where("account_id", "=", acct)
			.execute()
	)
		.map((r) => r.key)
		.sort();

describe.skipIf(!HAS_DB)("POST /internal/push", () => {
	test("missing key → 401", async () => {
		const acct = await makeAccount();
		expect((await post(base(acct), null)).status).toBe(401);
	});

	test("the wrong key → 401", async () => {
		const acct = await makeAccount();
		expect((await post(base(acct), "nope")).status).toBe(401);
	});

	test("an observedAt 10 minutes off → 400", async () => {
		const acct = await makeAccount();
		const res = await post({
			...base(acct),
			observedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
		});
		expect(res.status).toBe(400);
	});

	test("unknown account → 404", async () => {
		const res = await post(base(crypto.randomUUID()));
		expect(res.status).toBe(404);
	});

	test("a stopped subgraph claims its key once, and the same event again is a duplicate", async () => {
		const acct = await makeAccount();
		const body = { ...base(acct), stopped: [stopped] };
		const first = await post(body);
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ sent: 0, duplicate: 0, skipped: 1 });
		expect(await claimed(acct)).toEqual(["subgraph_stopped:sbtc-flows:1204"]);
		expect(await (await post(body)).json()).toEqual({
			sent: 0,
			duplicate: 1,
			skipped: 0,
		});
		const next = await post({
			...base(acct),
			stopped: [{ ...stopped, height: 1300 }],
		});
		expect(((await next.json()) as Counts).skipped).toBe(1);
	});

	test("a finished replay claims its id and finish time, and a repeat is a duplicate", async () => {
		const acct = await makeAccount();
		const body = { ...base(acct), replays: [replay] };
		await post(body);
		expect(await claimed(acct)).toEqual([`replay_done:rp_1:${finishedAt}`]);
		expect(((await (await post(body)).json()) as Counts).duplicate).toBe(1);
		// The same range replayed again finishes later: a new push.
		const again = await post({
			...base(acct),
			replays: [{ ...replay, finishedAt: "2026-10-18T11:00:00.000Z" }],
		});
		expect(((await again.json()) as Counts).duplicate).toBe(0);
	});

	test("a body with an insights field is rejected, tenant insights are never pushed", async () => {
		const acct = await makeAccount();
		const res = await post({ ...base(acct), insights: [] });
		expect(res.status).toBe(400);
		expect(await claimed(acct)).toEqual([]);
	});
});
