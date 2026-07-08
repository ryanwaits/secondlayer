import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import subscriptionsRouter from "../src/routes/subscriptions.ts";

const SKIP = !process.env.DATABASE_URL;
const ACCOUNT_ID = "a5e10000-0000-4000-8000-000000000009";
const SUBGRAPH_NAME = "subscriptions-api-test";
const DEDICATED_SUBGRAPH_NAME = "dedicated-subscriptions-api-test";
type TestEnv = {
	Variables: {
		accountId: string;
		tenantRole: string;
	};
};

describe.skipIf(SKIP)("Subscriptions API validation", () => {
	const app = new Hono<TestEnv>();
	const originalInstanceMode = process.env.INSTANCE_MODE;
	app.use("*", async (c, next) => {
		c.set("accountId", ACCOUNT_ID);
		await next();
	});
	app.route("/subscriptions", subscriptionsRouter);

	beforeAll(async () => {
		process.env.INSTANCE_MODE = "platform";
		process.env.SECONDLAYER_SECRETS_KEY =
			process.env.SECONDLAYER_SECRETS_KEY ??
			"0000000000000000000000000000000000000000000000000000000000000000";

		const db = getDb();
		await db.deleteFrom("subscription_deliveries").execute();
		await db.deleteFrom("subscription_outbox").execute();
		await db.deleteFrom("subscriptions").execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", SUBGRAPH_NAME)
			.execute();
		// Webhook subscriptions are a paid hosted-tenant action (free quota = 0),
		// so the test account needs a plan to create them.
		await db
			.insertInto("accounts")
			.values({
				id: ACCOUNT_ID,
				email: `${ACCOUNT_ID}@test.local`,
				plan: "launch",
			})
			.onConflict((oc) => oc.column("id").doUpdateSet({ plan: "launch" }))
			.execute();
		await registerSubgraph(db, {
			name: SUBGRAPH_NAME,
			version: "1.0.0",
			definition: {
				name: SUBGRAPH_NAME,
				sources: {},
				schema: {
					transfers: {
						columns: {
							sender: { type: "principal" },
							amount: { type: "uint" },
							memo: { type: "text" },
						},
					},
				},
			},
			schemaHash: "subscriptions-api-test",
			handlerPath: "/tmp/subscriptions-api-test.js",
			accountId: ACCOUNT_ID,
		});
	});

	afterAll(async () => {
		if (originalInstanceMode === undefined) {
			Reflect.deleteProperty(process.env, "INSTANCE_MODE");
		} else {
			process.env.INSTANCE_MODE = originalInstanceMode;
		}
		const db = getDb();
		await db.deleteFrom("subscription_deliveries").execute();
		await db.deleteFrom("subscription_outbox").execute();
		await db.deleteFrom("subscriptions").execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", SUBGRAPH_NAME)
			.execute();
		await db.deleteFrom("accounts").where("id", "=", ACCOUNT_ID).execute();
	});

	test("create rejects unknown table and filter fields", async () => {
		const unknownTable = await app.request("/subscriptions", {
			method: "POST",
			body: JSON.stringify({
				name: "bad-table",
				subgraphName: SUBGRAPH_NAME,
				tableName: "missing",
				url: "https://example.com/webhook",
			}),
		});
		expect(unknownTable.status).toBe(400);
		expect(await unknownTable.json()).toMatchObject({
			error: expect.stringContaining('Unknown table "missing"'),
		});

		const unknownField = await app.request("/subscriptions", {
			method: "POST",
			body: JSON.stringify({
				name: "bad-field",
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
				filter: { nope: "x" },
			}),
		});
		expect(unknownField.status).toBe(400);
		expect(await unknownField.json()).toMatchObject({
			error: 'Unknown filter field "nope" on table "transfers".',
		});
	});

	test("valid filters create and update still works", async () => {
		const created = await app.request("/subscriptions", {
			method: "POST",
			body: JSON.stringify({
				name: "valid-filter",
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
				filter: { amount: { gte: "1000" } },
			}),
		});
		expect(created.status).toBe(201);
		const body = (await created.json()) as {
			subscription: { id: string; filter: Record<string, unknown> };
		};
		expect(body.subscription.filter).toEqual({ amount: { gte: "1000" } });

		const updated = await app.request(
			`/subscriptions/${body.subscription.id}`,
			{
				method: "PATCH",
				body: JSON.stringify({ filter: { sender: "SP1" } }),
			},
		);
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({
			filter: { sender: "SP1" },
		});
	});

	test("update rejects filter fields outside the subscribed table", async () => {
		const created = await app.request("/subscriptions", {
			method: "POST",
			body: JSON.stringify({
				name: "bad-update-filter",
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { subscription: { id: string } };

		const updated = await app.request(
			`/subscriptions/${body.subscription.id}`,
			{
				method: "PATCH",
				body: JSON.stringify({ filter: { nope: "x" } }),
			},
		);
		expect(updated.status).toBe(400);
		expect(await updated.json()).toMatchObject({
			error: 'Unknown filter field "nope" on table "transfers".',
		});
	});

	test("replay validates block ranges before enqueue", async () => {
		const res = await app.request("/subscriptions/sub-1/replay", {
			method: "POST",
			body: JSON.stringify({ fromBlock: 10, toBlock: 5 }),
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			error: expect.stringContaining(
				"fromBlock must be less than or equal to toBlock",
			),
		});
	});

	test("replay over a >100k block range returns the known validation message", async () => {
		const created = await app.request("/subscriptions", {
			method: "POST",
			body: JSON.stringify({
				name: "replay-range-too-large",
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { subscription: { id: string } };

		const res = await app.request(
			`/subscriptions/${body.subscription.id}/replay`,
			{
				method: "POST",
				body: JSON.stringify({ fromBlock: 0, toBlock: 200_000 }),
			},
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			error: "replay range exceeds 100k blocks",
		});
	});

	// f052: replay against a subscription whose schema-declared table has no
	// physical table underneath throws a raw Postgres "relation does not exist"
	// error. That's exactly the kind of driver detail the route must not leak —
	// it should collapse to the same generic 500 shape as the global handler.
	test("replay swallows an unexpected DB error into a generic 500, not the raw driver message", async () => {
		const created = await app.request("/subscriptions", {
			method: "POST",
			body: JSON.stringify({
				name: "replay-unexpected-error",
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { subscription: { id: string } };

		// The `transfers` table exists only in the subgraph's schema JSON, not as
		// a physical Postgres table/schema — replaySubscription's raw SELECT will
		// throw "relation ... does not exist".
		const res = await app.request(
			`/subscriptions/${body.subscription.id}/replay`,
			{
				method: "POST",
				body: JSON.stringify({ fromBlock: 0, toBlock: 10 }),
			},
		);
		expect(res.status).toBe(500);
		const responseBody = await res.json();
		expect(responseBody).toEqual({
			error: "Internal Server Error",
			code: "INTERNAL_ERROR",
		});
		expect(JSON.stringify(responseBody)).not.toContain("relation");
		expect(JSON.stringify(responseBody)).not.toContain("does not exist");
	});
});

describe.skipIf(SKIP)("Subscriptions API pagination", () => {
	const PAGINATION_ACCOUNT_ID = "a5e10000-0000-4000-8000-000000000010";
	const PAGINATION_SUBGRAPH_NAME = "pagination-subscriptions-api-test";
	const app = new Hono<TestEnv>();
	const originalInstanceMode = process.env.INSTANCE_MODE;
	app.use("*", async (c, next) => {
		c.set("accountId", PAGINATION_ACCOUNT_ID);
		await next();
	});
	app.route("/subscriptions", subscriptionsRouter);

	beforeAll(async () => {
		process.env.INSTANCE_MODE = "platform";
		process.env.SECONDLAYER_SECRETS_KEY =
			process.env.SECONDLAYER_SECRETS_KEY ??
			"0000000000000000000000000000000000000000000000000000000000000000";

		const db = getDb();
		// Clean up any leftover data for this account
		await db
			.deleteFrom("subscriptions")
			.where("account_id", "=", PAGINATION_ACCOUNT_ID)
			.execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", PAGINATION_SUBGRAPH_NAME)
			.execute();
		await db
			.insertInto("accounts")
			.values({
				id: PAGINATION_ACCOUNT_ID,
				email: `${PAGINATION_ACCOUNT_ID}@test.local`,
				plan: "launch",
			})
			.onConflict((oc) => oc.column("id").doUpdateSet({ plan: "launch" }))
			.execute();
		await registerSubgraph(db, {
			name: PAGINATION_SUBGRAPH_NAME,
			version: "1.0.0",
			definition: {
				name: PAGINATION_SUBGRAPH_NAME,
				sources: {},
				schema: {
					transfers: {
						columns: {
							sender: { type: "principal" },
						},
					},
				},
			},
			schemaHash: "pagination-subscriptions-api-test",
			handlerPath: "/tmp/pagination-subscriptions-api-test.js",
			accountId: PAGINATION_ACCOUNT_ID,
		});

		// Seed 3 subscriptions
		for (let i = 1; i <= 3; i++) {
			await app.request("/subscriptions", {
				method: "POST",
				body: JSON.stringify({
					name: `page-sub-${i}`,
					subgraphName: PAGINATION_SUBGRAPH_NAME,
					tableName: "transfers",
					url: `https://example.com/webhook/${i}`,
				}),
			});
		}
	});

	afterAll(async () => {
		if (originalInstanceMode === undefined) {
			Reflect.deleteProperty(process.env, "INSTANCE_MODE");
		} else {
			process.env.INSTANCE_MODE = originalInstanceMode;
		}
		const db = getDb();
		await db
			.deleteFrom("subscriptions")
			.where("account_id", "=", PAGINATION_ACCOUNT_ID)
			.execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", PAGINATION_SUBGRAPH_NAME)
			.execute();
		await db
			.deleteFrom("accounts")
			.where("id", "=", PAGINATION_ACCOUNT_ID)
			.execute();
	});

	test("_limit=2 returns exactly 2 rows", async () => {
		const res = await app.request("/subscriptions?_limit=2");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: unknown[] };
		expect(body.data).toHaveLength(2);
	});

	test("_limit=2&_offset=2 returns the remaining 1 row", async () => {
		const res = await app.request("/subscriptions?_limit=2&_offset=2");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: unknown[] };
		expect(body.data).toHaveLength(1);
	});

	test("no params returns all 3 rows (< default 50)", async () => {
		const res = await app.request("/subscriptions");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: unknown[] };
		expect(body.data).toHaveLength(3);
	});
});

describe.skipIf(SKIP)("Subscriptions API dedicated scope", () => {
	const app = new Hono<TestEnv>();
	const originalInstanceMode = process.env.INSTANCE_MODE;
	app.use("*", async (c, next) => {
		c.set("tenantRole", "service");
		await next();
	});
	app.route("/subscriptions", subscriptionsRouter);

	beforeAll(async () => {
		process.env.INSTANCE_MODE = "dedicated";
		process.env.SECONDLAYER_SECRETS_KEY =
			process.env.SECONDLAYER_SECRETS_KEY ??
			"0000000000000000000000000000000000000000000000000000000000000000";

		const db = getDb();
		await db.deleteFrom("subscription_deliveries").execute();
		await db.deleteFrom("subscription_outbox").execute();
		await db.deleteFrom("subscriptions").execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", DEDICATED_SUBGRAPH_NAME)
			.execute();
		await registerSubgraph(db, {
			name: DEDICATED_SUBGRAPH_NAME,
			version: "1.0.0",
			definition: {
				name: DEDICATED_SUBGRAPH_NAME,
				sources: {},
				schema: {
					transfers: {
						columns: {
							sender: { type: "principal" },
						},
					},
				},
			},
			schemaHash: "dedicated-subscriptions-api-test",
			handlerPath: "/tmp/dedicated-subscriptions-api-test.js",
		});
	});

	afterAll(async () => {
		if (originalInstanceMode === undefined) {
			Reflect.deleteProperty(process.env, "INSTANCE_MODE");
		} else {
			process.env.INSTANCE_MODE = originalInstanceMode;
		}
		const db = getDb();
		await db.deleteFrom("subscription_deliveries").execute();
		await db.deleteFrom("subscription_outbox").execute();
		await db.deleteFrom("subscriptions").execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", DEDICATED_SUBGRAPH_NAME)
			.execute();
	});

	test("create uses the tenant-local empty account scope", async () => {
		const created = await app.request("/subscriptions", {
			method: "POST",
			body: JSON.stringify({
				name: "dedicated-valid",
				subgraphName: DEDICATED_SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		expect(created.status).toBe(201);
		const body = (await created.json()) as {
			subscription: { id: string; name: string };
		};
		expect(body.subscription.name).toBe("dedicated-valid");

		const row = await getDb()
			.selectFrom("subscriptions")
			.select(["id", "account_id"])
			.where("id", "=", body.subscription.id)
			.executeTakeFirstOrThrow();
		expect(row.account_id).toBe("");
	});
});
