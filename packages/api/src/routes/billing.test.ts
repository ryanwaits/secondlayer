import { afterAll, describe, expect, test } from "bun:test";
import { grantCredits, meter } from "@secondlayer/platform/billing/meter";
import { ROWS_DELIVERED_MONTHLY_ALLOWANCE } from "@secondlayer/platform/billing/prices";
import { creditCredits } from "@secondlayer/platform/db/queries/account-credits";
import { insertFailedRequest } from "@secondlayer/platform/db/queries/api-failed-requests";
import { getDb } from "@secondlayer/shared/db";
import { Hono, type MiddlewareHandler } from "hono";
import type Stripe from "stripe";
import { errorHandler } from "../middleware/error.ts";
import billingRouter, {
	type StripeClient,
	ensureStripeCustomer,
	isCreditPack,
	isResourceMissing,
	rowsAllowance,
	rowsBySource,
} from "./billing.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const db = HAS_DB ? getDb() : (null as never);

// Track seeded account ids for cleanup
const seededAccountIds: string[] = [];

async function makeAccount(
	email: string,
	stripeCustomerId?: string,
): Promise<Awaited<ReturnType<typeof getAccountRow>>> {
	const row = await db
		.insertInto("accounts")
		.values({ email, stripe_customer_id: stripeCustomerId ?? null })
		.returningAll()
		.executeTakeFirstOrThrow();
	seededAccountIds.push(row.id);
	return row;
}

// Re-select through the same query shape `ensureStripeCustomer` callers use,
// so the fixture matches the `AccountRow` type exactly.
async function getAccountRow(email: string) {
	return db
		.selectFrom("accounts")
		.selectAll()
		.where("email", "=", email)
		.executeTakeFirstOrThrow();
}

afterAll(async () => {
	for (const id of seededAccountIds) {
		await db.deleteFrom("accounts").where("id", "=", id).execute();
	}
});

/** Build a stub Stripe client implementing only what `ensureStripeCustomer`
 * calls, with call counters so double-create regressions are caught. */
function makeStubStripe(opts: {
	retrieve: (id: string) => Promise<unknown>;
	createdCustomerId: string;
}): { stripe: StripeClient; calls: { retrieve: number; create: number } } {
	const calls = { retrieve: 0, create: 0 };
	const stripe = {
		customers: {
			retrieve: async (id: string) => {
				calls.retrieve++;
				return opts.retrieve(id);
			},
			create: async (_params: unknown) => {
				calls.create++;
				return { id: opts.createdCustomerId } as unknown as Stripe.Customer;
			},
		},
	} as unknown as StripeClient;
	return { stripe, calls };
}

describe("isCreditPack", () => {
	test("accepts the four packs", () => {
		expect(isCreditPack(10)).toBe(true);
		expect(isCreditPack(25)).toBe(true);
		expect(isCreditPack(7)).toBe(false);
	});
});

describe("isResourceMissing", () => {
	test("matches Stripe's resource_missing code", () => {
		expect(isResourceMissing({ code: "resource_missing" })).toBe(true);
	});

	test("does not match a different error code", () => {
		expect(isResourceMissing({ code: "rate_limit" })).toBe(false);
	});

	test("does not match a plain Error with no code", () => {
		expect(isResourceMissing(new Error("boom"))).toBe(false);
	});

	test("does not match null/undefined/primitives", () => {
		expect(isResourceMissing(null)).toBe(false);
		expect(isResourceMissing(undefined)).toBe(false);
		expect(isResourceMissing("resource_missing")).toBe(false);
	});
});

describe.skipIf(!HAS_DB)("ensureStripeCustomer", () => {
	test("new customer: no stored id -> creates once and persists it", async () => {
		const email = `billing-test-new-${Date.now()}@test.invalid`;
		await makeAccount(email);
		const account = await getAccountRow(email);
		expect(account.stripe_customer_id).toBeNull();

		const { stripe, calls } = makeStubStripe({
			retrieve: async () => {
				throw new Error("should not be called — no stored id");
			},
			createdCustomerId: "cus_new_123",
		});

		const id = await ensureStripeCustomer(stripe, db, account);

		expect(id).toBe("cus_new_123");
		expect(calls.retrieve).toBe(0);
		expect(calls.create).toBe(1);

		const persisted = await getAccountRow(email);
		expect(persisted.stripe_customer_id).toBe("cus_new_123");
	});

	test("existing valid customer: reuses it, never creates", async () => {
		const email = `billing-test-valid-${Date.now()}@test.invalid`;
		await makeAccount(email, "cus_existing_valid");
		const account = await getAccountRow(email);

		const { stripe, calls } = makeStubStripe({
			retrieve: async (id) => {
				expect(id).toBe("cus_existing_valid");
				return { id, deleted: false } as unknown as Stripe.Customer;
			},
			createdCustomerId: "cus_should_not_be_created",
		});

		const id = await ensureStripeCustomer(stripe, db, account);

		expect(id).toBe("cus_existing_valid");
		expect(calls.retrieve).toBe(1);
		expect(calls.create).toBe(0);

		const persisted = await getAccountRow(email);
		expect(persisted.stripe_customer_id).toBe("cus_existing_valid");
	});

	test("existing-but-missing (retrieve throws resource_missing): recreates once", async () => {
		const email = `billing-test-missing-throw-${Date.now()}@test.invalid`;
		await makeAccount(email, "cus_stale_throws");
		const account = await getAccountRow(email);

		const { stripe, calls } = makeStubStripe({
			retrieve: async () => {
				const err = new Error("No such customer") as Error & {
					code: string;
				};
				err.code = "resource_missing";
				throw err;
			},
			createdCustomerId: "cus_recreated_via_throw",
		});

		const id = await ensureStripeCustomer(stripe, db, account);

		expect(id).toBe("cus_recreated_via_throw");
		expect(calls.retrieve).toBe(1);
		expect(calls.create).toBe(1);

		const persisted = await getAccountRow(email);
		expect(persisted.stripe_customer_id).toBe("cus_recreated_via_throw");
	});

	test("existing-but-deleted (retrieve resolves { deleted: true }): recreates once, no throw path", async () => {
		const email = `billing-test-missing-deleted-${Date.now()}@test.invalid`;
		await makeAccount(email, "cus_stale_deleted");
		const account = await getAccountRow(email);

		const { stripe, calls } = makeStubStripe({
			retrieve: async (id) =>
				({ id, deleted: true }) as unknown as Stripe.Customer,
			createdCustomerId: "cus_recreated_via_deleted",
		});

		const id = await ensureStripeCustomer(stripe, db, account);

		expect(id).toBe("cus_recreated_via_deleted");
		expect(calls.retrieve).toBe(1);
		expect(calls.create).toBe(1);

		const persisted = await getAccountRow(email);
		expect(persisted.stripe_customer_id).toBe("cus_recreated_via_deleted");
	});

	test("propagates a non-resource_missing retrieve error without creating", async () => {
		const email = `billing-test-other-error-${Date.now()}@test.invalid`;
		await makeAccount(email, "cus_other_error");
		const account = await getAccountRow(email);

		const { stripe, calls } = makeStubStripe({
			retrieve: async () => {
				const err = new Error("rate limited") as Error & { code: string };
				err.code = "rate_limit";
				throw err;
			},
			createdCustomerId: "cus_should_not_be_created",
		});

		await expect(ensureStripeCustomer(stripe, db, account)).rejects.toThrow(
			"rate limited",
		);
		expect(calls.retrieve).toBe(1);
		expect(calls.create).toBe(0);

		const persisted = await getAccountRow(email);
		expect(persisted.stripe_customer_id).toBe("cus_other_error");
	});
});

describe.skipIf(!HAS_DB)("GET /usage", () => {
	function appFor(accountId?: string) {
		const a = new Hono();
		const setAccountId: MiddlewareHandler = async (c, next) => {
			if (accountId) c.set("accountId", accountId);
			await next();
		};
		a.use("*", setAccountId);
		a.onError(errorHandler);
		a.route("/", billingRouter);
		return a;
	}

	test("unauthenticated → 401", async () => {
		const res = await appFor().request("/usage");
		expect(res.status).toBe(401);
	});

	test("malformed month → 400", async () => {
		const email = `billing-usage-bad-month-${Date.now()}@test.invalid`;
		const account = await makeAccount(email);
		const res = await appFor(account.id).request("/usage?month=2026-9");
		expect(res.status).toBe(400);
	});

	test("groups this month's ledger by unit", async () => {
		const email = `billing-usage-${Date.now()}@test.invalid`;
		const account = await makeAccount(email);
		await creditCredits(db, account.id, 1_000_000n);
		const now = new Date("2026-09-24T12:00:00.000Z");
		await meter(db, {
			accountId: account.id,
			unit: "archive.partition",
			quantity: 2,
			source: "test",
			idempotencyKey: `usage-test-${account.id}-1`,
			occurredAt: now,
		});
		await meter(db, {
			accountId: account.id,
			unit: "archive.partition.events",
			quantity: 1,
			source: "test",
			idempotencyKey: `usage-test-${account.id}-2`,
			occurredAt: now,
		});

		const res = await appFor(account.id).request("/usage?month=2026-09");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			month: string;
			usage: Array<{ unit: string; quantity: string; usdMicros: string }>;
		};
		expect(body.month).toBe("2026-09");
		const byUnit = new Map(body.usage.map((u) => [u.unit, u]));
		expect(byUnit.get("archive.partition")?.usdMicros).toBe("100000");
		expect(byUnit.get("archive.partition.events")?.usdMicros).toBe("150000");
	});

	test("a debited: false charge shows up as unpaidUsdMicros, not folded into the paid total", async () => {
		const email = `billing-usage-unpaid-${Date.now()}@test.invalid`;
		const account = await makeAccount(email);
		// No credits: the charge lands with debited: false.
		const now = new Date("2026-09-24T12:00:00.000Z");
		await meter(db, {
			accountId: account.id,
			unit: "webhook.event",
			quantity: 1000,
			source: "test",
			idempotencyKey: `unpaid-${account.id}`,
			occurredAt: now,
		});

		const res = await appFor(account.id).request("/usage?month=2026-09");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			usage: Array<{
				unit: string;
				quantity: string;
				usdMicros: string;
				unpaidUsdMicros: string;
			}>;
		};
		const row = body.usage.find((u) => u.unit === "webhook.event");
		// usdMicros still sums every row regardless of debited — unchanged
		// behavior; unpaidUsdMicros is the additive new field.
		expect(row?.usdMicros).toBe("10000");
		expect(row?.unpaidUsdMicros).toBe("10000");
	});

	type UsageResponseBody = {
		month: string;
		usage: Array<{ unit: string; quantity: string; usdMicros: string }>;
		daily: Array<{ date: string; unit: string; usdMicros: string }>;
		burn: { rateDayUsdMicros: string; windowHours: number };
		service: {
			state: "running" | "stopped" | "none";
			lastChargedAt: string | null;
			memory24h: Array<{
				hour: string;
				billedGb: number;
				observedGb: number | null;
			}>;
		};
	};

	test("service.state is running when a memory.gb_hour row landed in the last hour", async () => {
		const email = `billing-usage-svc-running-${Date.now()}@test.invalid`;
		const account = await makeAccount(email);
		await creditCredits(db, account.id, 1_000_000n);
		await meter(db, {
			accountId: account.id,
			unit: "memory.gb_hour",
			quantity: 0.5,
			observedQuantity: 0.3,
			source: "test",
			idempotencyKey: `svc-running-${account.id}`,
			occurredAt: new Date(Date.now() - 30 * 60 * 1000),
		});

		const res = await appFor(account.id).request("/usage");
		expect(res.status).toBe(200);
		const body = (await res.json()) as UsageResponseBody;
		expect(body.service.state).toBe("running");
		expect(body.service.lastChargedAt).not.toBeNull();
		expect(body.service.memory24h.length).toBeGreaterThan(0);
		expect(body.service.memory24h[0]?.observedGb).toBeCloseTo(0.3, 6);
	});

	test("service.state is stopped when the last memory.gb_hour row is 3h old", async () => {
		const email = `billing-usage-svc-stopped-${Date.now()}@test.invalid`;
		const account = await makeAccount(email);
		await creditCredits(db, account.id, 1_000_000n);
		await meter(db, {
			accountId: account.id,
			unit: "memory.gb_hour",
			quantity: 0.5,
			source: "test",
			idempotencyKey: `svc-stopped-${account.id}`,
			occurredAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
		});

		const res = await appFor(account.id).request("/usage");
		const body = (await res.json()) as UsageResponseBody;
		expect(body.service.state).toBe("stopped");
	});

	test("service.state is none with no memory.gb_hour history", async () => {
		const email = `billing-usage-svc-none-${Date.now()}@test.invalid`;
		const account = await makeAccount(email);
		await creditCredits(db, account.id, 1_000_000n);

		const res = await appFor(account.id).request("/usage");
		const body = (await res.json()) as UsageResponseBody;
		expect(body.service.state).toBe("none");
		expect(body.service.lastChargedAt).toBeNull();
		expect(body.service.memory24h).toHaveLength(0);
	});

	test("daily groups by UTC day, splitting a charge either side of midnight", async () => {
		const email = `billing-usage-daily-midnight-${Date.now()}@test.invalid`;
		const account = await makeAccount(email);
		await creditCredits(db, account.id, 1_000_000n);
		await meter(db, {
			accountId: account.id,
			unit: "webhook.event",
			quantity: 10,
			source: "test",
			idempotencyKey: `daily-before-midnight-${account.id}`,
			occurredAt: new Date("2026-09-01T23:30:00.000Z"),
		});
		await meter(db, {
			accountId: account.id,
			unit: "webhook.event",
			quantity: 20,
			source: "test",
			idempotencyKey: `daily-after-midnight-${account.id}`,
			occurredAt: new Date("2026-09-02T00:30:00.000Z"),
		});

		const res = await appFor(account.id).request("/usage?month=2026-09");
		const body = (await res.json()) as UsageResponseBody;
		const byDate = new Map(body.daily.map((d) => [d.date, d]));
		expect(byDate.get("2026-09-01")?.usdMicros).toBe("100");
		expect(byDate.get("2026-09-02")?.usdMicros).toBe("200");
	});

	test("burn excludes a charge older than the trailing 24h window", async () => {
		const email = `billing-usage-burn-window-${Date.now()}@test.invalid`;
		const account = await makeAccount(email);
		await creditCredits(db, account.id, 1_000_000n);
		await meter(db, {
			accountId: account.id,
			unit: "webhook.event",
			quantity: 1000,
			source: "test",
			idempotencyKey: `burn-old-${account.id}`,
			occurredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
		});
		await meter(db, {
			accountId: account.id,
			unit: "webhook.event",
			quantity: 5,
			source: "test",
			idempotencyKey: `burn-recent-${account.id}`,
			occurredAt: new Date(Date.now() - 60 * 60 * 1000),
		});

		const res = await appFor(account.id).request("/usage");
		const body = (await res.json()) as UsageResponseBody;
		// 5 events x 10µ$ = 50µ$; the 1000-event charge 25h ago must not count.
		expect(body.burn.rateDayUsdMicros).toBe("50");
		expect(body.burn.windowHours).toBe(24);
	});
});

describe.skipIf(!HAS_DB)("GET/PUT /alerts", () => {
	function appFor(accountId?: string) {
		const a = new Hono();
		const setAccountId: MiddlewareHandler = async (c, next) => {
			if (accountId) c.set("accountId", accountId);
			await next();
		};
		a.use("*", setAccountId);
		a.onError(errorHandler);
		a.route("/", billingRouter);
		return a;
	}

	test("GET unauthenticated → 401", async () => {
		const res = await appFor().request("/alerts");
		expect(res.status).toBe(401);
	});

	test("PUT unauthenticated → 401", async () => {
		const res = await appFor().request("/alerts", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ notify7d: false }),
		});
		expect(res.status).toBe(401);
	});

	test("GET with no row yet defaults both alerts on", async () => {
		const email = `billing-alerts-default-${Date.now()}@test.invalid`;
		const account = await makeAccount(email);
		const res = await appFor(account.id).request("/alerts");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { notify7d: boolean; notify2d: boolean };
		expect(body).toEqual({ notify7d: true, notify2d: true });
	});

	test("PUT one field leaves the other untouched, then GET reflects it", async () => {
		const email = `billing-alerts-put-${Date.now()}@test.invalid`;
		const account = await makeAccount(email);

		const put = await appFor(account.id).request("/alerts", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ notify7d: false }),
		});
		expect(put.status).toBe(200);
		expect(await put.json()).toEqual({ notify7d: false, notify2d: true });

		const get = await appFor(account.id).request("/alerts");
		expect(await get.json()).toEqual({ notify7d: false, notify2d: true });
	});

	test("PUT a non-boolean value → 400", async () => {
		const email = `billing-alerts-bad-value-${Date.now()}@test.invalid`;
		const account = await makeAccount(email);
		const res = await appFor(account.id).request("/alerts", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ notify2d: "yes" }),
		});
		expect(res.status).toBe(400);
	});
});

describe.skipIf(!HAS_DB)("GET /credits", () => {
	function appFor(accountId?: string) {
		const a = new Hono();
		const setAccountId: MiddlewareHandler = async (c, next) => {
			if (accountId) c.set("accountId", accountId);
			await next();
		};
		a.use("*", setAccountId);
		a.onError(errorHandler);
		a.route("/", billingRouter);
		return a;
	}

	test("unauthenticated → 401", async () => {
		const res = await appFor().request("/credits");
		expect(res.status).toBe(401);
	});

	test("lists a grant with a positive amount", async () => {
		const account = await makeAccount(
			`billing-credits-grant-${Date.now()}@test.invalid`,
		);
		await grantCredits(db, {
			accountId: account.id,
			usdMicros: 5_000_000n,
			source: "sentinel:starter",
			idempotencyKey: `credits-route-${account.id}`,
			occurredAt: new Date("2026-10-09T10:00:00.000Z"),
		});
		const res = await appFor(account.id).request("/credits");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			credits: [
				{
					occurredAt: "2026-10-09T10:00:00.000Z",
					kind: "grant",
					source: "sentinel:starter",
					usdMicros: "5000000",
				},
			],
		});
	});
});

describe("rowsBySource", () => {
	test("sums rows and calls across days per source, ordered by source", () => {
		const day = (
			date: string,
			source: string,
			rows: number,
			calls: number,
		) => ({
			date,
			source,
			rows,
			calls,
		});
		expect(
			rowsBySource([
				day("2026-10-10", "streams", 5, 1),
				day("2026-10-10", "index", 10, 1),
				day("2026-10-11", "streams", 7, 2),
				day("2026-10-11", "index", 20, 1),
			]),
		).toEqual([
			{ source: "index", rows: 30, calls: 2 },
			{ source: "streams", rows: 12, calls: 3 },
		]);
	});

	test("is empty with no days", () => {
		expect(rowsBySource([])).toEqual([]);
	});
});

describe("rowsAllowance", () => {
	const now = new Date("2026-10-15T12:00:00.000Z");
	const day = (date: string, rows: number, paidRows = 0) => ({
		date,
		rows,
		paidRows,
		paidUsdMicros: String(paidRows * 5),
	});

	test("exhaustedOn is the first day the running total reaches the allowance", () => {
		const allowance = rowsAllowance(
			[
				day("2026-10-02", 600_000),
				day("2026-10-06", 400_000),
				day("2026-10-07", 50, 50),
			],
			now,
		);
		expect(allowance.exhaustedOn).toBe("2026-10-06");
		expect(allowance.usedThisMonth).toBe(1_000_050);
		expect(allowance.paidRowsThisMonth).toBe(50);
		expect(allowance.paidUsdMicrosThisMonth).toBe("250");
		expect(allowance.resetsOn).toBe("2026-11-01");
		expect(allowance.monthly).toBe(ROWS_DELIVERED_MONTHLY_ALLOWANCE);
	});

	test("ignores last month's days and stays null under the allowance", () => {
		const allowance = rowsAllowance(
			[day("2026-09-30", 2_000_000, 1_000_000), day("2026-10-03", 10)],
			now,
		);
		expect(allowance.exhaustedOn).toBeNull();
		expect(allowance.usedThisMonth).toBe(10);
		expect(allowance.paidRowsThisMonth).toBe(0);
	});
});

describe.skipIf(!HAS_DB)("GET /rows", () => {
	function appFor(accountId?: string) {
		const a = new Hono();
		const setAccountId: MiddlewareHandler = async (c, next) => {
			if (accountId) c.set("accountId", accountId);
			await next();
		};
		a.use("*", setAccountId);
		a.onError(errorHandler);
		a.route("/", billingRouter);
		return a;
	}

	type RowsBody = {
		allowance: {
			usedThisMonth: number;
			exhaustedOn: string | null;
			paidRowsThisMonth: number;
		};
		daily: Array<{ source: string; rows: number; paidRows: number }>;
		bySource: Array<{ source: string; rows: number; calls: number }>;
		histogram: Array<{ bucket: string; calls: number }>;
		errors: Array<{ status: number; path: string; count: number }>;
	};

	test("unauthenticated → 401", async () => {
		const res = await appFor().request("/rows");
		expect(res.status).toBe(401);
	});

	test("an account that crossed the allowance reports exhaustedOn and paid rows", async () => {
		const account = await makeAccount(
			`billing-rows-over-${Date.now()}@test.invalid`,
		);
		await meter(db, {
			accountId: account.id,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE,
			source: "index",
			idempotencyKey: `rows-route-a-${account.id}`,
		});
		await meter(db, {
			accountId: account.id,
			unit: "rows.delivered",
			quantity: 25,
			source: "streams",
			idempotencyKey: `rows-route-b-${account.id}`,
		});

		const res = await appFor(account.id).request("/rows");
		expect(res.status).toBe(200);
		const body = (await res.json()) as RowsBody;
		expect(body.allowance.exhaustedOn).toBe(
			new Date().toISOString().slice(0, 10),
		);
		expect(body.allowance.usedThisMonth).toBe(
			ROWS_DELIVERED_MONTHLY_ALLOWANCE + 25,
		);
		expect(body.allowance.paidRowsThisMonth).toBe(25);
		expect(body.bySource.map((s) => s.source)).toEqual(["index", "streams"]);
		expect(body.histogram).toHaveLength(5);
	});

	test("an account under the allowance has exhaustedOn null", async () => {
		const account = await makeAccount(
			`billing-rows-under-${Date.now()}@test.invalid`,
		);
		await meter(db, {
			accountId: account.id,
			unit: "rows.delivered",
			quantity: 42,
			source: "index",
			idempotencyKey: `rows-route-under-${account.id}`,
		});
		const res = await appFor(account.id).request("/rows");
		const body = (await res.json()) as RowsBody;
		expect(body.allowance.exhaustedOn).toBeNull();
		expect(body.allowance.usedThisMonth).toBe(42);
		expect(body.daily[0]?.paidRows).toBe(0);
	});

	test("includes the account's own failed requests from the last 24h", async () => {
		const account = await makeAccount(
			`billing-rows-errors-${Date.now()}@test.invalid`,
		);
		for (const n of [1, 2]) {
			await insertFailedRequest(db, {
				request_id: `rows-route-err-${n}-${account.id}`,
				account_id: account.id,
				method: "GET",
				path: "/v1/index/ft-transfers",
				status: 404,
				code: "NOT_FOUND",
				message: "nope",
				query: {},
				origin: null,
			});
		}
		const res = await appFor(account.id).request("/rows");
		const body = (await res.json()) as RowsBody;
		expect(body.errors).toHaveLength(1);
		expect(body.errors[0]).toMatchObject({
			status: 404,
			path: "/v1/index/ft-transfers",
			count: 2,
		});
	});
});
