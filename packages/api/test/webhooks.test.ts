import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { __setReplayInFlightForTest } from "@secondlayer/subgraphs/runtime/replay";
import { Hono } from "hono";
import webhooksRouter from "../src/routes/webhooks.ts";

const SKIP = !process.env.DATABASE_URL;
const ACCOUNT_ID = "a5e10000-0000-4000-8000-000000000009";
const SUBGRAPH_NAME = "webhooks-api-test";
const DEDICATED_SUBGRAPH_NAME = "dedicated-webhooks-api-test";
type TestEnv = {
	Variables: {
		accountId: string;
		tenantRole: string;
	};
};

describe.skipIf(SKIP)("Webhooks API validation", () => {
	const app = new Hono<TestEnv>();
	const originalInstanceMode = process.env.INSTANCE_MODE;
	app.use("*", async (c, next) => {
		c.set("accountId", ACCOUNT_ID);
		await next();
	});
	app.route("/webhooks", webhooksRouter);

	beforeAll(async () => {
		process.env.INSTANCE_MODE = "platform";
		process.env.SECONDLAYER_SECRETS_KEY =
			process.env.SECONDLAYER_SECRETS_KEY ??
			"0000000000000000000000000000000000000000000000000000000000000000";

		const db = getDb();
		await db.deleteFrom("webhook_deliveries").execute();
		await db.deleteFrom("webhook_outbox").execute();
		await db.deleteFrom("webhooks").execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", SUBGRAPH_NAME)
			.execute();
		await db
			.insertInto("accounts")
			.values({
				id: ACCOUNT_ID,
				email: `${ACCOUNT_ID}@test.local`,
			})
			.onConflict((oc) => oc.column("id").doNothing())
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
			schemaHash: "webhooks-api-test",
			handlerPath: "/tmp/webhooks-api-test.js",
			accountId: ACCOUNT_ID,
		});
	});

	afterAll(async () => {
		if (originalInstanceMode === undefined) {
			Reflect.deleteProperty(process.env, "INSTANCE_MODE");
		} else {
			if (originalInstanceMode === undefined) delete process.env.INSTANCE_MODE;
			else process.env.INSTANCE_MODE = originalInstanceMode;
		}
		const db = getDb();
		await db.deleteFrom("webhook_deliveries").execute();
		await db.deleteFrom("webhook_outbox").execute();
		await db.deleteFrom("webhooks").execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", SUBGRAPH_NAME)
			.execute();
		await db.deleteFrom("accounts").where("id", "=", ACCOUNT_ID).execute();
	});

	test("create rejects unknown table and filter fields", async () => {
		const unknownTable = await app.request("/webhooks", {
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

		const unknownField = await app.request("/webhooks", {
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
		const created = await app.request("/webhooks", {
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
			webhook: { id: string; filter: Record<string, unknown> };
		};
		expect(body.webhook.filter).toEqual({ amount: { gte: "1000" } });

		const updated = await app.request(`/webhooks/${body.webhook.id}`, {
			method: "PATCH",
			body: JSON.stringify({ filter: { sender: "SP1" } }),
		});
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({
			filter: { sender: "SP1" },
		});
	});

	test("update rejects filter fields outside the subscribed table", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "bad-update-filter",
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { webhook: { id: string } };

		const updated = await app.request(`/webhooks/${body.webhook.id}`, {
			method: "PATCH",
			body: JSON.stringify({ filter: { nope: "x" } }),
		});
		expect(updated.status).toBe(400);
		expect(await updated.json()).toMatchObject({
			error: 'Unknown filter field "nope" on table "transfers".',
		});
	});

	test("replay validates block ranges before enqueue", async () => {
		const res = await app.request("/webhooks/sub-1/replay", {
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
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "replay-range-too-large",
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { webhook: { id: string } };

		const res = await app.request(`/webhooks/${body.webhook.id}/replay`, {
			method: "POST",
			body: JSON.stringify({ fromBlock: 0, toBlock: 200_000 }),
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			error: "replay range exceeds 100k blocks",
		});
	});

	test("create warns on a chain webhook when the chain-trigger evaluator isn't running", async () => {
		const originalSubgraphSource = process.env.SUBGRAPH_SOURCE;
		Reflect.deleteProperty(process.env, "SUBGRAPH_SOURCE");
		try {
			const res = await app.request("/webhooks", {
				method: "POST",
				body: JSON.stringify({
					name: "chain-evaluator-idle",
					triggers: [{ type: "contract_call" }],
					url: "https://example.com/webhook",
				}),
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				webhook: { warning: string | null };
			};
			expect(body.webhook.warning).toContain(
				"chain-trigger evaluator is not running",
			);
		} finally {
			if (originalSubgraphSource === undefined) {
				Reflect.deleteProperty(process.env, "SUBGRAPH_SOURCE");
			} else {
				process.env.SUBGRAPH_SOURCE = originalSubgraphSource;
			}
		}
	});

	test("create does not warn on a subgraph webhook regardless of SUBGRAPH_SOURCE", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "no-warning-subgraph-webhook",
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		expect(created.status).toBe(201);
		const body = (await created.json()) as {
			webhook: { warning: string | null };
		};
		expect(body.webhook.warning).toBeNull();
	});

	test("replay returns 409 when a replay is already in progress for the webhook", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "replay-concurrency",
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { webhook: { id: string } };

		__setReplayInFlightForTest(body.webhook.id, true);
		try {
			const res = await app.request(`/webhooks/${body.webhook.id}/replay`, {
				method: "POST",
				body: JSON.stringify({ fromBlock: 0, toBlock: 10 }),
			});
			expect(res.status).toBe(409);
			expect(await res.json()).toMatchObject({
				error: "replay already in progress for this webhook",
			});
		} finally {
			__setReplayInFlightForTest(body.webhook.id, false);
		}
	});

	// f052: replay against a webhook whose schema-declared table has no
	// physical table underneath throws a raw Postgres "relation does not exist"
	// error. That's exactly the kind of driver detail the route must not leak —
	// it should collapse to the same generic 500 shape as the global handler.
	test("replay swallows an unexpected DB error into a generic 500, not the raw driver message", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "replay-unexpected-error",
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { webhook: { id: string } };

		// The `transfers` table exists only in the subgraph's schema JSON, not as
		// a physical Postgres table/schema — replayWebhook's raw SELECT will
		// throw "relation ... does not exist".
		const res = await app.request(`/webhooks/${body.webhook.id}/replay`, {
			method: "POST",
			body: JSON.stringify({ fromBlock: 0, toBlock: 10 }),
		});
		expect(res.status).toBe(500);
		const responseBody = await res.json();
		expect(responseBody).toEqual({
			error: "Internal Server Error",
			code: "INTERNAL_ERROR",
		});
		expect(JSON.stringify(responseBody)).not.toContain("relation");
		expect(JSON.stringify(responseBody)).not.toContain("does not exist");
	});

	test("deliveries report the delivered event's block time, or null without one", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "deliveries-block-time",
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { webhook: { id: string } };
		const webhookId = body.webhook.id;

		const db = getDb();
		const blockTime = new Date("2026-04-23T00:00:00.000Z");
		const outbox = await db
			.insertInto("webhook_outbox")
			.values({
				webhook_id: webhookId,
				subgraph_name: SUBGRAPH_NAME,
				table_name: "transfers",
				block_height: 42,
				tx_id: "0xtimed",
				row_pk: { blockHeight: 42, txId: "0xtimed", rowIndex: 0 },
				event_type: `${SUBGRAPH_NAME}.transfers.created`,
				payload: { amount: "1" },
				dedup_key: "deliveries-block-time-outbox",
				block_time: blockTime,
			})
			.returning("id")
			.executeTakeFirstOrThrow();

		await db
			.insertInto("webhook_deliveries")
			.values([
				{
					webhook_id: webhookId,
					outbox_id: outbox.id,
					attempt: 1,
					status_code: 200,
				},
				{
					// No outbox row (e.g. a test delivery) — blockTime must be null.
					webhook_id: webhookId,
					outbox_id: null,
					attempt: 1,
					status_code: 200,
				},
			])
			.execute();

		const res = await app.request(`/webhooks/${webhookId}/deliveries`);
		expect(res.status).toBe(200);
		const { data } = (await res.json()) as {
			data: Array<{ blockTime: string | null }>;
		};
		expect(data).toHaveLength(2);
		const withOutbox = data.find((d) => d.blockTime !== null);
		const withoutOutbox = data.find((d) => d.blockTime === null);
		expect(withOutbox?.blockTime).toBe(blockTime.toISOString());
		expect(withoutOutbox?.blockTime).toBeNull();
	});
});

describe.skipIf(SKIP)("Webhooks API pagination", () => {
	const PAGINATION_ACCOUNT_ID = "a5e10000-0000-4000-8000-000000000010";
	const PAGINATION_SUBGRAPH_NAME = "pagination-webhooks-api-test";
	const app = new Hono<TestEnv>();
	const originalInstanceMode = process.env.INSTANCE_MODE;
	app.use("*", async (c, next) => {
		c.set("accountId", PAGINATION_ACCOUNT_ID);
		await next();
	});
	app.route("/webhooks", webhooksRouter);

	beforeAll(async () => {
		process.env.INSTANCE_MODE = "platform";
		process.env.SECONDLAYER_SECRETS_KEY =
			process.env.SECONDLAYER_SECRETS_KEY ??
			"0000000000000000000000000000000000000000000000000000000000000000";

		const db = getDb();
		// Clean up any leftover data for this account
		await db
			.deleteFrom("webhooks")
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
			})
			.onConflict((oc) => oc.column("id").doNothing())
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
			schemaHash: "pagination-webhooks-api-test",
			handlerPath: "/tmp/pagination-webhooks-api-test.js",
			accountId: PAGINATION_ACCOUNT_ID,
		});

		// Seed 3 webhooks
		for (let i = 1; i <= 3; i++) {
			await app.request("/webhooks", {
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
			if (originalInstanceMode === undefined) delete process.env.INSTANCE_MODE;
			else process.env.INSTANCE_MODE = originalInstanceMode;
		}
		const db = getDb();
		await db
			.deleteFrom("webhooks")
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
		const res = await app.request("/webhooks?_limit=2");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: unknown[] };
		expect(body.data).toHaveLength(2);
	});

	test("_limit=2&_offset=2 returns the remaining 1 row", async () => {
		const res = await app.request("/webhooks?_limit=2&_offset=2");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: unknown[] };
		expect(body.data).toHaveLength(1);
	});

	test("no params returns all 3 rows (< default 50)", async () => {
		const res = await app.request("/webhooks");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: unknown[] };
		expect(body.data).toHaveLength(3);
	});
});

describe.skipIf(SKIP)("Webhooks API dedicated scope", () => {
	const app = new Hono<TestEnv>();
	const originalInstanceMode = process.env.INSTANCE_MODE;
	app.use("*", async (c, next) => {
		c.set("tenantRole", "service");
		await next();
	});
	app.route("/webhooks", webhooksRouter);

	beforeAll(async () => {
		process.env.INSTANCE_MODE = "dedicated";
		process.env.SECONDLAYER_SECRETS_KEY =
			process.env.SECONDLAYER_SECRETS_KEY ??
			"0000000000000000000000000000000000000000000000000000000000000000";

		const db = getDb();
		await db.deleteFrom("webhook_deliveries").execute();
		await db.deleteFrom("webhook_outbox").execute();
		await db.deleteFrom("webhooks").execute();
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
			schemaHash: "dedicated-webhooks-api-test",
			handlerPath: "/tmp/dedicated-webhooks-api-test.js",
		});
	});

	afterAll(async () => {
		if (originalInstanceMode === undefined) {
			Reflect.deleteProperty(process.env, "INSTANCE_MODE");
		} else {
			if (originalInstanceMode === undefined) delete process.env.INSTANCE_MODE;
			else process.env.INSTANCE_MODE = originalInstanceMode;
		}
		const db = getDb();
		await db.deleteFrom("webhook_deliveries").execute();
		await db.deleteFrom("webhook_outbox").execute();
		await db.deleteFrom("webhooks").execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", DEDICATED_SUBGRAPH_NAME)
			.execute();
	});

	test("create uses the tenant-local empty account scope", async () => {
		const created = await app.request("/webhooks", {
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
			webhook: { id: string; name: string };
		};
		expect(body.webhook.name).toBe("dedicated-valid");

		const row = await getDb()
			.selectFrom("webhooks")
			.select(["id", "account_id"])
			.where("id", "=", body.webhook.id)
			.executeTakeFirstOrThrow();
		expect(row.account_id).toBe("");
	});
});

describe("webhook mount paths", () => {
	test("GET /api/subscriptions is 404; /api/webhooks keeps auth shape", async () => {
		const { createApiApp } = await import("../src/create-app.ts");
		const app = createApiApp("oss");
		const legacy = await app.request("/api/subscriptions");
		const current = await app.request("/api/webhooks");
		expect(legacy.status).toBe(404);
		expect([200, 401]).toContain(current.status);
	});
});
