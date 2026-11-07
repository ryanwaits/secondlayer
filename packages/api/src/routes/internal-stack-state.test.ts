import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getServiceState } from "@secondlayer/platform/db/queries/hosted-stack-state";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import internalStackStateRouter from "./internal-stack-state.ts";

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
	if (prevKey === undefined)
		Reflect.deleteProperty(process.env, "WORKLOAD_HOST_KEY");
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
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/internal/stack-state", internalStackStateRouter);
	return app.request("/internal/stack-state", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(key ? { authorization: `Bearer ${key}` } : {}),
		},
		body: JSON.stringify(body),
	});
}

const entry = (
	account_id: string,
	state: string,
	stop_reason: string | null,
	observed_at = new Date().toISOString(),
) => ({ account_id, state, stop_reason, observed_at });

describe("POST /internal/stack-state", () => {
	test("rejects a missing or wrong host key", async () => {
		expect((await post({ states: [] }, null)).status).toBe(401);
		expect((await post({ states: [] }, "nope")).status).toBe(401);
	});

	test("rejects a stopped stack with no reason, and a reason on a running one", async () => {
		const id = crypto.randomUUID();
		expect((await post({ states: [entry(id, "stopped", null)] })).status).toBe(
			400,
		);
		expect(
			(await post({ states: [entry(id, "running", "idle")] })).status,
		).toBe(400);
		expect((await post({ states: [entry(id, "paused", null)] })).status).toBe(
			400,
		);
	});

	test("rejects an observation in the future", async () => {
		const id = crypto.randomUUID();
		const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
		expect(
			(await post({ states: [entry(id, "running", null, future)] })).status,
		).toBe(400);
	});

	test.skipIf(!HAS_DB)(
		"stores the report and ignores a stale one",
		async () => {
			const id = await makeAccount();
			const t = Date.now();
			const iso = (offsetMs: number) => new Date(t + offsetMs).toISOString();

			const first = await post({
				states: [entry(id, "stopped", "credits", iso(0))],
			});
			expect(first.status).toBe(200);
			expect(await first.json()).toEqual({ applied: 1 });
			expect(await getServiceState(db, id)).toBe("stopped_credits");

			const stale = await post({
				states: [entry(id, "running", null, iso(-5000))],
			});
			expect(await stale.json()).toEqual({ applied: 0 });
			expect(await getServiceState(db, id)).toBe("stopped_credits");

			await post({ states: [entry(id, "running", null, iso(1000))] });
			expect(await getServiceState(db, id)).toBe("running");
		},
	);
});
