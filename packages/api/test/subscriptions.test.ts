import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import subscriptionsRouter from "../src/routes/subscriptions.ts";

const SKIP = !process.env.DATABASE_URL;
const ACCOUNT_ID = "acc-subscriptions-api-test";
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
