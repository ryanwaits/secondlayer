import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import type { InsertWebhookOutbox } from "@secondlayer/shared/db";
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

	async function createTestWebhook(name: string): Promise<string> {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name,
				subgraphName: SUBGRAPH_NAME,
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { webhook: { id: string } };
		return body.webhook.id;
	}

	function outboxRow(
		overrides: Partial<InsertWebhookOutbox> &
			Pick<InsertWebhookOutbox, "webhook_id" | "dedup_key">,
	): InsertWebhookOutbox {
		return {
			subgraph_name: SUBGRAPH_NAME,
			table_name: "transfers",
			block_height: 1,
			tx_id: "0xactivity",
			row_pk: { blockHeight: 1, txId: "0xactivity", rowIndex: 0 },
			event_type: `${SUBGRAPH_NAME}.transfers.created`,
			payload: { amount: "1" },
			...overrides,
		};
	}

	test("activity zero-fills 168 hours and counts one row per status in its hour", async () => {
		const webhookId = await createTestWebhook("activity-basic");
		const db = getDb();
		const now = new Date();
		const currentHour = new Date(
			Math.floor(now.getTime() / 3_600_000) * 3_600_000,
		);
		const outsideWindow = new Date(currentHour.getTime() - 200 * 3_600_000);

		await db
			.insertInto("webhook_outbox")
			.values([
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "activity-basic-delivered",
					status: "delivered",
					created_at: currentHour,
				}),
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "activity-basic-pending",
					status: "pending",
					created_at: currentHour,
				}),
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "activity-basic-dead",
					status: "dead",
					created_at: currentHour,
				}),
				// Older than the 168-hour window — must not be counted.
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "activity-basic-outside-window",
					status: "delivered",
					created_at: outsideWindow,
				}),
			])
			.execute();

		const res = await app.request(`/webhooks/${webhookId}/activity`);
		expect(res.status).toBe(200);
		const activity = (await res.json()) as {
			hours: {
				hour: string;
				delivered: number;
				waiting: number;
				gaveUp: number;
			}[];
			waiting: number;
		};
		expect(activity.hours).toHaveLength(168);
		expect(activity.hours[0]?.hour).toBe(
			new Date(currentHour.getTime() - 167 * 3_600_000).toISOString(),
		);
		expect(activity.hours[167]?.hour).toBe(currentHour.toISOString());
		expect(activity.hours[167]).toMatchObject({
			delivered: 1,
			waiting: 1,
			gaveUp: 1,
		});
		const otherHours = activity.hours.slice(0, 167);
		for (const bucket of otherHours) {
			expect(bucket.delivered + bucket.waiting + bucket.gaveUp).toBe(0);
		}
	});

	test("activity reports waiting count and next retry with no time bound, and the latest success", async () => {
		const webhookId = await createTestWebhook("activity-waiting-lastsuccess");
		const db = getDb();
		const farPast = new Date(Date.now() - 300 * 3_600_000);
		const nextAttemptAt = new Date("2026-05-01T12:00:00.000Z");

		// Outside the 168-hour chart window, but `waiting` has no time bound —
		// it must still be counted here.
		await db
			.insertInto("webhook_outbox")
			.values(
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "activity-waiting-old-pending",
					status: "pending",
					created_at: farPast,
					next_attempt_at: nextAttemptAt,
				}),
			)
			.execute();

		const lastSuccessAt = new Date("2026-04-01T00:00:00.000Z");
		await db
			.insertInto("webhook_deliveries")
			.values([
				{
					webhook_id: webhookId,
					outbox_id: null,
					attempt: 1,
					status_code: 200,
					dispatched_at: lastSuccessAt,
				},
				// A later, failed delivery must not move lastSuccessAt forward.
				{
					webhook_id: webhookId,
					outbox_id: null,
					attempt: 2,
					status_code: 500,
					dispatched_at: new Date("2026-04-15T00:00:00.000Z"),
				},
			])
			.execute();

		const res = await app.request(`/webhooks/${webhookId}/activity`);
		expect(res.status).toBe(200);
		const activity = (await res.json()) as {
			waiting: number;
			nextAttemptAt: string | null;
			lastSuccessAt: string | null;
		};
		expect(activity.waiting).toBe(1);
		expect(activity.nextAttemptAt).toBe(nextAttemptAt.toISOString());
		expect(activity.lastSuccessAt).toBe(lastSuccessAt.toISOString());
	});

	test("activity 404s for a webhook owned by a different account", async () => {
		const webhookId = await createTestWebhook("activity-cross-account");
		await getDb()
			.updateTable("webhooks")
			.set({ account_id: "a5e10000-0000-4000-8000-0000000000ff" })
			.where("id", "=", webhookId)
			.execute();

		const res = await app.request(`/webhooks/${webhookId}/activity`);
		expect(res.status).toBe(404);
	});

	test("delivery detail returns the outbox context for a live delivery", async () => {
		const webhookId = await createTestWebhook("delivery-detail-live");
		const db = getDb();
		const blockTime = new Date("2026-04-23T00:00:00.000Z");
		const outbox = await db
			.insertInto("webhook_outbox")
			.values(
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "delivery-detail-live-outbox",
					block_time: blockTime,
				}),
			)
			.returning("id")
			.executeTakeFirstOrThrow();
		const delivery = await db
			.insertInto("webhook_deliveries")
			.values({
				webhook_id: webhookId,
				outbox_id: outbox.id,
				attempt: 1,
				status_code: 200,
				duration_ms: 61,
				response_body: '{"ok":true}',
				response_headers: { "content-type": "application/json" },
			})
			.returning("id")
			.executeTakeFirstOrThrow();

		const res = await app.request(
			`/webhooks/${webhookId}/deliveries/${delivery.id}`,
		);
		expect(res.status).toBe(200);
		const detail = (await res.json()) as {
			outboxId: string | null;
			payload: unknown;
			blockTime: string | null;
			responseHeaders: Record<string, string> | null;
			eventIndex: number | null;
		};
		expect(detail.outboxId).toBe(outbox.id);
		expect(detail.payload).toEqual({ amount: "1" });
		expect(detail.blockTime).toBe(blockTime.toISOString());
		expect(detail.responseHeaders).toEqual({
			"content-type": "application/json",
		});
		expect(detail.eventIndex).toBe(0);
	});

	test("delivery detail reads a chain-trigger row's event_index, not just a subgraph row's rowIndex", async () => {
		const webhookId = await createTestWebhook("delivery-detail-chain-index");
		const db = getDb();
		const outbox = await db
			.insertInto("webhook_outbox")
			.values(
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "delivery-detail-chain-index-outbox",
					row_pk: { tx_id: "0xchain", event_index: 3 },
				}),
			)
			.returning("id")
			.executeTakeFirstOrThrow();
		const delivery = await db
			.insertInto("webhook_deliveries")
			.values({
				webhook_id: webhookId,
				outbox_id: outbox.id,
				attempt: 1,
				status_code: 200,
			})
			.returning("id")
			.executeTakeFirstOrThrow();

		const res = await app.request(
			`/webhooks/${webhookId}/deliveries/${delivery.id}`,
		);
		const detail = (await res.json()) as { eventIndex: number | null };
		expect(detail.eventIndex).toBe(3);
	});

	test("delivery detail's event index is null when row_pk carries neither shape", async () => {
		const webhookId = await createTestWebhook("delivery-detail-no-index");
		const db = getDb();
		const outbox = await db
			.insertInto("webhook_outbox")
			.values(
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "delivery-detail-no-index-outbox",
					row_pk: { sweep_txid: "0xsweep" },
				}),
			)
			.returning("id")
			.executeTakeFirstOrThrow();
		const delivery = await db
			.insertInto("webhook_deliveries")
			.values({
				webhook_id: webhookId,
				outbox_id: outbox.id,
				attempt: 1,
				status_code: 200,
			})
			.returning("id")
			.executeTakeFirstOrThrow();

		const res = await app.request(
			`/webhooks/${webhookId}/deliveries/${delivery.id}`,
		);
		const detail = (await res.json()) as { eventIndex: number | null };
		expect(detail.eventIndex).toBeNull();
	});

	test("delivery detail reports a null payload once the outbox row is gone", async () => {
		const webhookId = await createTestWebhook("delivery-detail-compacted");
		const delivery = await getDb()
			.insertInto("webhook_deliveries")
			.values({
				webhook_id: webhookId,
				outbox_id: null,
				attempt: 1,
				status_code: 200,
			})
			.returning("id")
			.executeTakeFirstOrThrow();

		const res = await app.request(
			`/webhooks/${webhookId}/deliveries/${delivery.id}`,
		);
		expect(res.status).toBe(200);
		const detail = (await res.json()) as {
			outboxId: string | null;
			payload: unknown;
		};
		expect(detail.outboxId).toBeNull();
		expect(detail.payload).toBeNull();
	});

	test("delivery detail 400s on a non-UUID deliveryId", async () => {
		const webhookId = await createTestWebhook("delivery-detail-bad-id");
		const res = await app.request(
			`/webhooks/${webhookId}/deliveries/not-a-uuid`,
		);
		expect(res.status).toBe(400);
	});

	test("delivery detail 404s for a delivery that belongs to a different webhook", async () => {
		const webhookIdA = await createTestWebhook("delivery-detail-owner-a");
		const webhookIdB = await createTestWebhook("delivery-detail-owner-b");
		const delivery = await getDb()
			.insertInto("webhook_deliveries")
			.values({
				webhook_id: webhookIdA,
				outbox_id: null,
				attempt: 1,
				status_code: 200,
			})
			.returning("id")
			.executeTakeFirstOrThrow();

		const res = await app.request(
			`/webhooks/${webhookIdB}/deliveries/${delivery.id}`,
		);
		expect(res.status).toBe(404);
	});

	test("delivery detail 404s for a webhook owned by a different account", async () => {
		const webhookId = await createTestWebhook("delivery-detail-cross-account");
		const delivery = await getDb()
			.insertInto("webhook_deliveries")
			.values({
				webhook_id: webhookId,
				outbox_id: null,
				attempt: 1,
				status_code: 200,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		await getDb()
			.updateTable("webhooks")
			.set({ account_id: "a5e10000-0000-4000-8000-0000000000ff" })
			.where("id", "=", webhookId)
			.execute();

		const res = await app.request(
			`/webhooks/${webhookId}/deliveries/${delivery.id}`,
		);
		expect(res.status).toBe(404);
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
