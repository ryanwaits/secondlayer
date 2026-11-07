import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	creditCredits,
	getCredits,
} from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { createApiApp } from "../create-app.ts";
import { errorHandler } from "../middleware/error.ts";
import internalMetersRouter, {
	workloadHostKeyMatches,
} from "./internal-meters.ts";

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

let accountId: string;
let prevKey: string | undefined;

beforeEach(async () => {
	prevKey = process.env.WORKLOAD_HOST_KEY;
	process.env.WORKLOAD_HOST_KEY = "test-workload-host-key";
	if (!HAS_DB) return;
	accountId = await makeAccount();
});

afterEach(async () => {
	if (prevKey === undefined) delete process.env.WORKLOAD_HOST_KEY;
	else process.env.WORKLOAD_HOST_KEY = prevKey;
	if (!HAS_DB) return;
	await db
		.deleteFrom("usage_ledger")
		.where("account_id", "=", accountId)
		.execute();
	await db
		.deleteFrom("account_credits")
		.where("account_id", "=", accountId)
		.execute();
});

afterAll(async () => {
	if (!HAS_DB) return;
	if (accountIds.length > 0) {
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

/** The batch answers 200 and its only item is rejected with a reason. */
async function expectOnlyRejected(res: Response): Promise<void> {
	expect(res.status).toBe(200);
	const body = (await res.json()) as {
		results: Array<{ status: string; error?: string }>;
	};
	expect(body.results).toHaveLength(1);
	expect(body.results[0]?.status).toBe("rejected");
	expect(body.results[0]?.error).toBeTruthy();
}

function app() {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/internal/meters", internalMetersRouter);
	return a;
}

describe("workloadHostKeyMatches", () => {
	test("unset key authenticates nobody", () => {
		expect(workloadHostKeyMatches("anything", {})).toBe(false);
	});

	test("wrong key does not match", () => {
		expect(
			workloadHostKeyMatches("wrong", { WORKLOAD_HOST_KEY: "right" }),
		).toBe(false);
	});

	test("matching key matches", () => {
		expect(
			workloadHostKeyMatches("right", { WORKLOAD_HOST_KEY: "right" }),
		).toBe(true);
	});
});

describe.skipIf(!HAS_DB)("POST /internal/meters", () => {
	test("missing Authorization → 401", async () => {
		const res = await app().request("/internal/meters", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ items: [] }),
		});
		expect(res.status).toBe(401);
	});

	test("wrong key → 401", async () => {
		const res = await app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer nope",
			},
			body: JSON.stringify({ items: [] }),
		});
		expect(res.status).toBe(401);
	});

	test("when WORKLOAD_HOST_KEY is unset, every request 401s", async () => {
		delete process.env.WORKLOAD_HOST_KEY;
		const res = await app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ items: [] }),
		});
		expect(res.status).toBe(401);
	});

	test("negative observedQuantity is rejected for that item, not the batch", async () => {
		const res = await app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({
				items: [
					{
						accountId,
						unit: "memory.gb_hour",
						quantity: 0.5,
						observedQuantity: -1,
						idempotencyKey: "neg-observed",
					},
				],
			}),
		});
		await expectOnlyRejected(res);
	});

	test("occurredAt more than 5 minutes in the future is rejected for that item, not the batch", async () => {
		const future = new Date(Date.now() + 6 * 60_000).toISOString();
		const res = await app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({
				items: [
					{
						accountId,
						unit: "memory.gb_hour",
						quantity: 0.5,
						idempotencyKey: "future-occurred-at",
						occurredAt: future,
					},
				],
			}),
		});
		await expectOnlyRejected(res);
	});

	test("occurredAt more than 35 days old is rejected for that item, not the batch", async () => {
		const tooOld = new Date(
			Date.now() - 36 * 24 * 60 * 60 * 1000,
		).toISOString();
		const res = await app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({
				items: [
					{
						accountId,
						unit: "memory.gb_hour",
						quantity: 0.5,
						idempotencyKey: "too-old-occurred-at",
						occurredAt: tooOld,
					},
				],
			}),
		});
		await expectOnlyRejected(res);
	});

	test("occurredAt that isn't a parseable date is rejected for that item, not the batch", async () => {
		const res = await app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({
				items: [
					{
						accountId,
						unit: "memory.gb_hour",
						quantity: 0.5,
						idempotencyKey: "garbage-occurred-at",
						occurredAt: "not-a-date",
					},
				],
			}),
		});
		await expectOnlyRejected(res);
	});

	test("a retried batch's occurredAt (real sample time, within bounds) is accepted and stored", async () => {
		const { creditCredits } = await import(
			"@secondlayer/platform/db/queries/account-credits"
		);
		await creditCredits(db, accountId, 1_000_000n);
		const sampledAt = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
		const res = await app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({
				items: [
					{
						accountId,
						unit: "memory.gb_hour",
						quantity: 0.5,
						idempotencyKey: "retry-keeps-occurred-at",
						occurredAt: sampledAt.toISOString(),
					},
				],
			}),
		});
		expect(res.status).toBe(200);
		const row = await db
			.selectFrom("usage_ledger")
			.select("occurred_at")
			.where("idempotency_key", "=", "retry-keeps-occurred-at")
			.executeTakeFirstOrThrow();
		expect(new Date(row.occurred_at).getTime()).toBe(sampledAt.getTime());
	});

	test("unknown unit is rejected for that item, not the batch", async () => {
		const res = await app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({
				items: [
					{
						accountId,
						unit: "not.a.real.unit",
						quantity: 1,
						idempotencyKey: "k1",
					},
				],
			}),
		});
		await expectOnlyRejected(res);
	});

	test("batch over the cap → 413", async () => {
		const items = Array.from({ length: 501 }, (_, i) => ({
			accountId,
			unit: "webhook.event",
			quantity: 1,
			idempotencyKey: `over-cap-${i}`,
		}));
		const res = await app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ items }),
		});
		expect(res.status).toBe(413);
	});

	test("meters a batch and is idempotent on replay", async () => {
		const { creditCredits } = await import(
			"@secondlayer/platform/db/queries/account-credits"
		);
		await creditCredits(db, accountId, 1_000_000n);

		const items = [
			{
				accountId,
				unit: "webhook.event",
				quantity: 100,
				idempotencyKey: "batch-1-item-1",
			},
			{
				accountId,
				unit: "memory.gb_hour",
				quantity: 2,
				observedQuantity: 1.7,
				idempotencyKey: "batch-1-item-2",
			},
		];

		const first = await app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ items }),
		});
		expect(first.status).toBe(200);
		const firstBody = (await first.json()) as {
			results: Array<{ usd_micros: number; debited: boolean }>;
		};
		expect(firstBody.results).toHaveLength(2);
		expect(firstBody.results[0]?.usd_micros).toBe(1_000); // 100 events x 10µ$
		expect(firstBody.results[1]?.usd_micros).toBe(56_000); // 2 GB-hours x 28,000µ$

		const memoryRow = await db
			.selectFrom("usage_ledger")
			.select("observed_quantity")
			.where("idempotency_key", "=", "batch-1-item-2")
			.executeTakeFirstOrThrow();
		expect(Number(memoryRow.observed_quantity)).toBeCloseTo(1.7, 6);

		const balanceAfterFirst = await getCredits(db, accountId);

		// Replay the exact same batch — no double charge.
		const second = await app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ items }),
		});
		expect(second.status).toBe(200);
		expect(await getCredits(db, accountId)).toBe(balanceAfterFirst);
	});
});

describe.skipIf(!HAS_DB)("POST /internal/meters: per-item results", () => {
	function post(items: unknown[]) {
		return app().request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ items }),
		});
	}

	type Result = {
		status: string;
		idempotencyKey: string | null;
		usd_micros?: number;
		error?: string;
	};

	test("one bad item is rejected and the rest of the batch is still billed", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const res = await post([
			{
				accountId,
				unit: "webhook.event",
				quantity: 100,
				idempotencyKey: `mixed-good-1-${accountId}`,
			},
			{
				accountId,
				unit: "not.a.real.unit",
				quantity: 1,
				idempotencyKey: `mixed-bad-${accountId}`,
			},
			{
				accountId,
				unit: "memory.gb_hour",
				quantity: 2,
				idempotencyKey: `mixed-good-2-${accountId}`,
			},
		]);
		expect(res.status).toBe(200);
		const { results } = (await res.json()) as { results: Result[] };
		expect(results.map((r) => r.status)).toEqual(["ok", "rejected", "ok"]);
		expect(results[0]?.usd_micros).toBe(1_000); // 100 events x 10 µ$
		expect(results[1]?.idempotencyKey).toBe(`mixed-bad-${accountId}`);
		expect(results[2]?.usd_micros).toBe(56_000); // 2 GB-hours x 28,000 µ$
		// Both good items debited: 1_000_000 - 1_000 - 56_000.
		expect(await getCredits(db, accountId)).toBe(943_000n);
	});

	test("an item for an account that does not exist is rejected, not a batch failure", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const res = await post([
			{
				accountId: "00000000-0000-4000-8000-000000000000",
				unit: "webhook.event",
				quantity: 1,
				idempotencyKey: `ghost-account-${accountId}`,
			},
			{
				accountId: "not-a-uuid",
				unit: "webhook.event",
				quantity: 1,
				idempotencyKey: `malformed-account-${accountId}`,
			},
			{
				accountId,
				unit: "webhook.event",
				quantity: 10,
				idempotencyKey: `real-account-${accountId}`,
			},
		]);
		expect(res.status).toBe(200);
		const { results } = (await res.json()) as { results: Result[] };
		expect(results.map((r) => r.status)).toEqual([
			"rejected",
			"rejected",
			"ok",
		]);
		expect(await getCredits(db, accountId)).toBe(999_900n);
	});

	test("a non-object item is rejected without a key and the batch still answers", async () => {
		const res = await post([null, 7]);
		expect(res.status).toBe(200);
		const { results } = (await res.json()) as { results: Result[] };
		expect(results).toEqual([
			{
				status: "rejected",
				idempotencyKey: null,
				error: "items[0] must be an object",
			},
			{
				status: "rejected",
				idempotencyKey: null,
				error: "items[1] must be an object",
			},
		]);
	});
});

describe.skipIf(!HAS_DB)("mounted on the platform app", () => {
	let prevDevMode: string | undefined;
	beforeEach(() => {
		prevDevMode = process.env.DEV_MODE;
		process.env.DEV_MODE = "false";
	});
	afterEach(() => {
		if (prevDevMode === undefined) delete process.env.DEV_MODE;
		else process.env.DEV_MODE = prevDevMode;
	});

	test("mounted at /internal/meters, not gated by account resourceAuth", async () => {
		const api = createApiApp("platform");
		const res = await api.request("/internal/meters", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-workload-host-key",
			},
			body: JSON.stringify({ items: [] }),
		});
		// Reaches the route's own guard (400 on empty items), not the
		// session-auth 401 the ACCOUNT_PATHS middleware would give.
		expect(res.status).toBe(400);
	});

	test("not mounted in oss mode", async () => {
		const api = createApiApp("oss");
		const res = await api.request("/internal/meters", { method: "POST" });
		expect(res.status).toBe(404);
	});
});

describe.skipIf(!HAS_DB)(
	"POST /internal/meters: retired sentinel units",
	() => {
		function post(key: string, items: unknown[]) {
			return app().request("/internal/meters", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${key}`,
				},
				body: JSON.stringify({ items }),
			});
		}

		test.each([
			"sentinel.run",
			"sentinel.deep_audit",
			"sentinel.check_run",
			"sentinel.monitored_event",
		])(
			"retired %s is rejected for the workload key, nothing charged",
			async (unit) => {
				await creditCredits(db, accountId, 5_000_000n);
				const res = await post("test-workload-host-key", [
					{
						accountId,
						unit,
						quantity: 1,
						idempotencyKey: `wl-retired-${unit}-${accountId}`,
					},
				]);
				expect(res.status).toBe(200);
				expect(JSON.stringify(await res.json())).toContain("retired");
				expect(await getCredits(db, accountId)).toBe(5_000_000n);
			},
		);

		test("the Sentinel service key no longer opens /internal/meters", async () => {
			const prev = process.env.SENTINEL_SERVICE_KEY;
			process.env.SENTINEL_SERVICE_KEY = "test-sentinel-key";
			try {
				const res = await post("test-sentinel-key", [
					{
						accountId,
						unit: "webhook.event",
						quantity: 1,
						idempotencyKey: `sentinel:evt:${accountId}`,
					},
				]);
				expect(res.status).toBe(401);
			} finally {
				if (prev === undefined) delete process.env.SENTINEL_SERVICE_KEY;
				else process.env.SENTINEL_SERVICE_KEY = prev;
			}
		});

		test("workload key still meters any live unit", async () => {
			await creditCredits(db, accountId, 1_000_000n);
			const res = await post("test-workload-host-key", [
				{
					accountId,
					unit: "webhook.event",
					quantity: 10,
					idempotencyKey: `wl-${accountId}`,
				},
			]);
			expect(res.status).toBe(200);
		});

		test("negative quantity is rejected and never credits the account", async () => {
			const res = await post("test-workload-host-key", [
				{
					accountId,
					unit: "webhook.event",
					quantity: -5,
					idempotencyKey: `wl-neg-${accountId}`,
				},
			]);
			await expectOnlyRejected(res);
			expect(await getCredits(db, accountId)).toBe(0n);
		});
	},
);
