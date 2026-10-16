import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import type { InsertWebhookOutbox } from "@secondlayer/shared/db";
import { __setReplayInFlightForTest } from "@secondlayer/subgraphs/runtime/replay";
import { Hono } from "hono";
import webhooksRouter, {
	percentileNearestRank,
	usualBand,
} from "../src/routes/webhooks.ts";

const SKIP = !process.env.DATABASE_URL;
const ACCOUNT_ID = "a5e10000-0000-4000-8000-000000000009";
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
			.insertInto("accounts")
			.values({
				id: ACCOUNT_ID,
				email: `${ACCOUNT_ID}@test.local`,
			})
			.onConflict((oc) => oc.column("id").doNothing())
			.execute();
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
		await db.deleteFrom("accounts").where("id", "=", ACCOUNT_ID).execute();
	});

	test("create answers SUBGRAPH_WEBHOOKS_REMOVED for a body naming a subgraph table", async () => {
		const res = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "removed-subgraph-webhook",
				subgraphName: "sbtc-flows",
				tableName: "transfers",
				url: "https://example.com/webhook",
			}),
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			code: "SUBGRAPH_WEBHOOKS_REMOVED",
			error: expect.stringContaining(
				"/docs/subgraphs/reading#react-to-your-rows",
			),
		});
	});

	test("create answers SUBGRAPH_WEBHOOKS_REMOVED even when triggers are also sent", async () => {
		const res = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "removed-filter",
				triggers: [{ type: "stx_transfer" }],
				url: "https://example.com/webhook",
				filter: { amount: { gte: "1000" } },
			}),
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			code: "SUBGRAPH_WEBHOOKS_REMOVED",
		});
	});

	test("create without triggers is rejected", async () => {
		const res = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "no-triggers",
				url: "https://example.com/webhook",
			}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; code?: string };
		expect(body.error).toContain("triggers");
		expect(body.code).toBeUndefined();
	});

	test("update answers SUBGRAPH_WEBHOOKS_REMOVED for a body carrying filter", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "update-with-filter",
				triggers: [{ type: "stx_transfer" }],
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { webhook: { id: string } };

		const updated = await app.request(`/webhooks/${body.webhook.id}`, {
			method: "PATCH",
			body: JSON.stringify({ filter: { sender: "SP1" } }),
		});
		expect(updated.status).toBe(400);
		expect(await updated.json()).toMatchObject({
			code: "SUBGRAPH_WEBHOOKS_REMOVED",
		});
	});

	test("a webhook's receiver credentials never come back in the response", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "auth-redaction",
				triggers: [{ type: "stx_transfer" }],
				url: "https://example.com/webhook",
				authConfig: {
					authType: "bearer",
					token: "s3cret",
					headers: { "x-team": "a" },
				},
			}),
		});
		expect(created.status).toBe(201);
		const createdText = await created.text();
		expect(createdText).not.toContain("s3cret");
		// "a" alone is too common to grep for; check the header's own value
		// isn't echoed back next to its name instead.
		expect(createdText).not.toContain('"x-team":"a"');
		const createdBody = JSON.parse(createdText) as {
			webhook: { id: string; auth: unknown };
		};
		expect(createdBody.webhook.auth).toEqual({
			type: "bearer",
			headerNames: ["x-team"],
			hasSecret: true,
		});
		expect(createdBody.webhook).not.toHaveProperty("authConfig");

		const got = await app.request(`/webhooks/${createdBody.webhook.id}`);
		expect(got.status).toBe(200);
		const gotText = await got.text();
		expect(gotText).not.toContain("s3cret");
		expect(JSON.parse(gotText)).toMatchObject({
			auth: { type: "bearer", headerNames: ["x-team"], hasSecret: true },
		});

		// The list response never carried auth at all, but it's a cheap
		// regression guard against that ever changing.
		const list = await app.request("/webhooks");
		const listText = await list.text();
		expect(listText).not.toContain("s3cret");
	});

	test("auth type falls back to bearer when a token is set without an explicit authType", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "auth-implicit-bearer",
				triggers: [{ type: "stx_transfer" }],
				url: "https://example.com/webhook",
				authConfig: { token: "implicit-token" },
			}),
		});
		const body = (await created.json()) as { webhook: { auth: unknown } };
		expect(body.webhook.auth).toEqual({
			type: "bearer",
			headerNames: [],
			hasSecret: true,
		});
	});

	test("no auth config at all reads back as type none with no secret", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "auth-none",
				triggers: [{ type: "stx_transfer" }],
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { webhook: { auth: unknown } };
		expect(body.webhook.auth).toEqual({
			type: "none",
			headerNames: [],
			hasSecret: false,
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
				triggers: [{ type: "stx_transfer" }],
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

	test("replay returns 409 when a replay is already in progress for the webhook", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "replay-concurrency",
				triggers: [{ type: "stx_transfer" }],
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

	// Replay loads canonical blocks over HTTP from the Index API. When that
	// fetch fails the raw network error must not leak to the client — it
	// collapses to the same generic 500 shape as the global handler.
	test("replay swallows an unexpected block-source error into a generic 500, not the raw error", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "replay-unexpected-error",
				triggers: [{ type: "stx_transfer" }],
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { webhook: { id: string } };

		// No Index API is reachable from the test process, so loading the block
		// range throws a raw connection error. Point the client at a closed local
		// port: the default host `api` is a DNS lookup that can take ~1s per
		// attempt on a CI runner, and the client retries, which outruns the test
		// timeout.
		const previousIndexUrl = process.env.SUBGRAPH_INDEX_API_URL;
		process.env.SUBGRAPH_INDEX_API_URL = "http://127.0.0.1:9";
		try {
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
			expect(JSON.stringify(responseBody)).not.toContain("ECONNREFUSED");
			expect(JSON.stringify(responseBody)).not.toContain("fetch");
		} finally {
			if (previousIndexUrl === undefined) {
				delete process.env.SUBGRAPH_INDEX_API_URL;
			} else {
				process.env.SUBGRAPH_INDEX_API_URL = previousIndexUrl;
			}
		}
	});

	test("deliveries report the delivered event's block time, or null without one", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "deliveries-block-time",
				triggers: [{ type: "stx_transfer" }],
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
				block_height: 42,
				tx_id: "0xtimed",
				row_pk: { tx_id: "0xtimed", event_index: 0 },
				event_type: "chain.stx_transfer.apply",
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

	test("deliveries report the outbox row's tx id and its row_pk's event index", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "deliveries-event-index",
				triggers: [{ type: "stx_transfer" }],
				url: "https://example.com/webhook",
			}),
		});
		const body = (await created.json()) as { webhook: { id: string } };
		const webhookId = body.webhook.id;

		const db = getDb();
		const outbox = await db
			.insertInto("webhook_outbox")
			.values({
				webhook_id: webhookId,
				block_height: 42,
				tx_id: "0xindexed",
				row_pk: { tx_id: "0xindexed", event_index: 3 },
				event_type: "chain.stx_transfer.apply",
				payload: { amount: "1" },
				dedup_key: "deliveries-event-index-outbox",
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
					// No outbox row — txId and eventIndex must both be null.
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
			data: Array<{ txId: string | null; eventIndex: number | null }>;
		};
		expect(data).toHaveLength(2);
		const withOutbox = data.find((d) => d.txId !== null);
		const withoutOutbox = data.find((d) => d.txId === null);
		expect(withOutbox).toMatchObject({ txId: "0xindexed", eventIndex: 3 });
		expect(withoutOutbox?.eventIndex).toBeNull();
	});

	async function createTestWebhook(name: string): Promise<string> {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name,
				triggers: [{ type: "stx_transfer" }],
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
			block_height: 1,
			tx_id: "0xactivity",
			row_pk: { tx_id: "0xactivity", event_index: 0 },
			event_type: "chain.stx_transfer.apply",
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

	test("activity's byEventType counts per event type in the 168-hour window, excluding older rows", async () => {
		const webhookId = await createTestWebhook("activity-by-event-type");
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
					dedup_key: "by-event-type-transfer-1",
					event_type: "chain.stx_transfer.apply",
					created_at: currentHour,
				}),
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "by-event-type-transfer-2",
					event_type: "chain.stx_transfer.apply",
					created_at: currentHour,
				}),
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "by-event-type-print",
					event_type: "chain.print_event.apply",
					created_at: currentHour,
				}),
				// Older than the 168-hour window — must not be counted.
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "by-event-type-outside-window",
					event_type: "chain.stx_transfer.apply",
					created_at: outsideWindow,
				}),
			])
			.execute();

		const res = await app.request(`/webhooks/${webhookId}/activity`);
		expect(res.status).toBe(200);
		const activity = (await res.json()) as {
			byEventType: Record<string, number>;
		};
		expect(activity.byEventType).toEqual({
			"chain.stx_transfer.apply": 2,
			"chain.print_event.apply": 1,
		});
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

	test("the list carries each webhook's consecutive failure count", async () => {
		const webhookId = await createTestWebhook("list-circuit-failures");
		await getDb()
			.updateTable("webhooks")
			.set({ circuit_failures: 6 })
			.where("id", "=", webhookId)
			.execute();

		const res = await app.request("/webhooks");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { id: string; circuitFailures: number }[];
		};
		expect(body.data.find((w) => w.id === webhookId)?.circuitFailures).toBe(6);
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
					status: "delivered",
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
			outboxStatus: string | null;
			payload: unknown;
			blockTime: string | null;
			responseHeaders: Record<string, string> | null;
			eventIndex: number | null;
		};
		expect(detail.outboxId).toBe(outbox.id);
		expect(detail.outboxStatus).toBe("delivered");
		expect(detail.payload).toEqual({ amount: "1" });
		expect(detail.blockTime).toBe(blockTime.toISOString());
		expect(detail.responseHeaders).toEqual({
			"content-type": "application/json",
		});
		expect(detail.eventIndex).toBe(0);
	});

	test("delivery detail's outboxStatus is dead only when the outbox row exhausted retries", async () => {
		const webhookId = await createTestWebhook("delivery-detail-dead-outbox");
		const db = getDb();
		const outbox = await db
			.insertInto("webhook_outbox")
			.values(
				outboxRow({
					webhook_id: webhookId,
					dedup_key: "delivery-detail-dead-outbox-outbox",
					status: "dead",
				}),
			)
			.returning("id")
			.executeTakeFirstOrThrow();
		const delivery = await db
			.insertInto("webhook_deliveries")
			.values({
				webhook_id: webhookId,
				outbox_id: outbox.id,
				attempt: 5,
				status_code: 502,
			})
			.returning("id")
			.executeTakeFirstOrThrow();

		const res = await app.request(
			`/webhooks/${webhookId}/deliveries/${delivery.id}`,
		);
		const detail = (await res.json()) as { outboxStatus: string | null };
		expect(detail.outboxStatus).toBe("dead");
	});

	test("delivery detail reads a chain-trigger row's event_index", async () => {
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
			outboxStatus: string | null;
			payload: unknown;
		};
		expect(detail.outboxId).toBeNull();
		expect(detail.outboxStatus).toBeNull();
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

	// ── managed names ────────────────────────────────────────────────

	function patchName(id: string, name: string) {
		return app.request(`/webhooks/${id}`, {
			method: "PATCH",
			body: JSON.stringify({ name }),
		});
	}

	test("renaming a plain webhook returns the new name", async () => {
		const id = await createTestWebhook("rename-plain");
		const res = await patchName(id, "rename-plain-2");
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			name: "rename-plain-2",
			managedBy: null,
		});
	});

	test("renaming a sentinel-owned webhook is refused", async () => {
		const id = await createTestWebhook("sentinel:SP1.vault:set-admin");
		const res = await patchName(id, "my-own-name");
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ code: "WEBHOOK_NAME_MANAGED" });
	});

	test("renaming a plain webhook into the sentinel prefix is refused", async () => {
		const id = await createTestWebhook("rename-into-sentinel");
		const res = await patchName(id, "sentinel:x");
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ code: "WEBHOOK_NAME_MANAGED" });
	});

	test("renaming onto an existing name is refused", async () => {
		await createTestWebhook("rename-taken");
		const id = await createTestWebhook("rename-wants-taken");
		const res = await patchName(id, "rename-taken");
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({
			error: 'Webhook "rename-taken" already exists',
		});
	});

	test("patching only the url of a sentinel-owned webhook still works", async () => {
		const id = await createTestWebhook("sentinel:SP2.vault:url-only");
		const res = await app.request(`/webhooks/${id}`, {
			method: "PATCH",
			body: JSON.stringify({ url: "https://example.com/moved" }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			url: "https://example.com/moved",
			managedBy: "Sentinel",
		});
	});

	test("list and detail carry managedBy", async () => {
		const id = await createTestWebhook("sentinel:SP3.vault:listed");
		const list = (await (await app.request("/webhooks")).json()) as {
			data: { id: string; managedBy: string | null }[];
		};
		expect(list.data.find((w) => w.id === id)?.managedBy).toBe("Sentinel");
		const detail = (await (await app.request(`/webhooks/${id}`)).json()) as {
			managedBy: string | null;
		};
		expect(detail.managedBy).toBe("Sentinel");
	});

	test("detail reports the receiver certificate expiry once probed", async () => {
		const id = await createTestWebhook("cert-expiry");
		const before = (await (await app.request(`/webhooks/${id}`)).json()) as {
			receiverCertExpiresAt: string | null;
		};
		expect(before.receiverCertExpiresAt).toBeNull();
		const expires = new Date("2027-01-02T03:04:05.000Z");
		await getDb()
			.updateTable("webhooks")
			.set({ receiver_cert_expires_at: expires })
			.where("id", "=", id)
			.execute();
		const after = (await (await app.request(`/webhooks/${id}`)).json()) as {
			receiverCertExpiresAt: string | null;
		};
		expect(after.receiverCertExpiresAt).toBe(expires.toISOString());
	});

	// ── delivery windows ─────────────────────────────────────────────

	function currentHourStart(): Date {
		return new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
	}

	test("deliveries with a window return only attempts dispatched inside it", async () => {
		const id = await createTestWebhook("deliveries-window");
		const h = currentHourStart().getTime() - 5 * 3_600_000;
		await getDb()
			.insertInto("webhook_deliveries")
			.values(
				[2, 1, 0].map((back) => ({
					webhook_id: id,
					outbox_id: null,
					attempt: 1,
					status_code: 200,
					dispatched_at: new Date(h - back * 3_600_000 + 60_000),
				})),
			)
			.execute();
		const from = new Date(h - 3_600_000).toISOString();
		const to = new Date(h).toISOString();
		const res = await app.request(
			`/webhooks/${id}/deliveries?from=${from}&to=${to}`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			total: number;
			data: { dispatchedAt: string }[];
		};
		expect(body.total).toBe(1);
		expect(body.data).toHaveLength(1);
		expect(body.data[0]?.dispatchedAt).toBe(
			new Date(h - 3_600_000 + 60_000).toISOString(),
		);

		const all = (await (
			await app.request(`/webhooks/${id}/deliveries`)
		).json()) as { total: number };
		expect(all.total).toBe(3);
	});

	test("deliveries reject a malformed, reversed, half-open or oversized window", async () => {
		const id = await createTestWebhook("deliveries-bad-window");
		const t = "2026-10-01T00:00:00.000Z";
		const cases = [
			"from=nope&to=nope",
			`from=${t}`,
			`from=${t}&to=2026-09-30T00:00:00.000Z`,
			`from=${t}&to=2026-11-15T00:00:00.000Z`,
		];
		for (const qs of cases) {
			const res = await app.request(`/webhooks/${id}/deliveries?${qs}`);
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ code: "INVALID_WINDOW" });
		}
	});

	// ── activity: failed attempts, band, 30 days ─────────────────────

	type ActivityBody = {
		hours: { hour: string; delivered: number; failed: number }[];
		usualByHourOfDay: { lo: number; hi: number }[] | null;
		days?: { day: string; delivered: number; failed: number }[];
	};

	test("activity counts failed attempts per hour next to outbox-based delivered", async () => {
		const id = await createTestWebhook("activity-failed");
		const hour = new Date(currentHourStart().getTime() - 2 * 3_600_000);
		const at = new Date(hour.getTime() + 60_000);
		await getDb()
			.insertInto("webhook_outbox")
			.values(
				outboxRow({
					webhook_id: id,
					dedup_key: "activity-failed-delivered",
					status: "delivered",
					created_at: hour,
				}),
			)
			.execute();
		await getDb()
			.insertInto("webhook_deliveries")
			.values([
				{
					webhook_id: id,
					outbox_id: null,
					attempt: 1,
					status_code: 503,
					dispatched_at: at,
				},
				{
					webhook_id: id,
					outbox_id: null,
					attempt: 2,
					status_code: null,
					dispatched_at: at,
				},
				{
					webhook_id: id,
					outbox_id: null,
					attempt: 3,
					status_code: 200,
					dispatched_at: at,
				},
			])
			.execute();
		const activity = (await (
			await app.request(`/webhooks/${id}/activity`)
		).json()) as ActivityBody;
		const bucket = activity.hours.find((h) => h.hour === hour.toISOString());
		expect(bucket).toMatchObject({ delivered: 1, failed: 2 });
		expect(activity.days).toBeUndefined();
	});

	test("activity hides the usual band at low volume", async () => {
		const id = await createTestWebhook("activity-band-low");
		await getDb()
			.insertInto("webhook_deliveries")
			.values({
				webhook_id: id,
				outbox_id: null,
				attempt: 1,
				status_code: 200,
				dispatched_at: new Date(currentHourStart().getTime() - 3_600_000),
			})
			.execute();
		const activity = (await (
			await app.request(`/webhooks/${id}/activity`)
		).json()) as ActivityBody;
		expect(activity.usualByHourOfDay).toBeNull();
	});

	test("activity reports a steady 2-per-hour history as lo=hi=2 at every hour of day", async () => {
		const id = await createTestWebhook("activity-band-steady");
		const end = currentHourStart().getTime();
		const rows = [];
		for (let back = 1; back <= 28 * 24; back++) {
			for (const offset of [60_000, 120_000]) {
				rows.push({
					webhook_id: id,
					outbox_id: null,
					attempt: 1,
					status_code: 200,
					dispatched_at: new Date(end - back * 3_600_000 + offset),
				});
			}
		}
		await getDb().insertInto("webhook_deliveries").values(rows).execute();
		const started = performance.now();
		const res = await app.request(`/webhooks/${id}/activity`);
		const elapsedMs = performance.now() - started;
		console.log(
			`[plan-244] activity (with 28d band) took ${elapsedMs.toFixed(0)} ms`,
		);
		const activity = (await res.json()) as ActivityBody;
		expect(activity.usualByHourOfDay).toHaveLength(24);
		for (const band of activity.usualByHourOfDay ?? []) {
			expect(band).toEqual({ lo: 2, hi: 2 });
		}
	});

	test("activity days=30 returns 30 zero-filled UTC days with attempts bucketed", async () => {
		const id = await createTestWebhook("activity-days");
		const empty = (await (
			await app.request(`/webhooks/${id}/activity?days=30`)
		).json()) as ActivityBody;
		expect(empty.days).toHaveLength(30);
		expect(empty.days?.every((d) => d.delivered === 0 && d.failed === 0)).toBe(
			true,
		);
		const todayKey = new Date().toISOString().slice(0, 10);
		expect(empty.days?.[29]?.day).toBe(todayKey);

		await getDb()
			.insertInto("webhook_deliveries")
			.values([
				{ webhook_id: id, outbox_id: null, attempt: 1, status_code: 200 },
				{ webhook_id: id, outbox_id: null, attempt: 1, status_code: 500 },
			])
			.execute();
		const filled = (await (
			await app.request(`/webhooks/${id}/activity?days=30`)
		).json()) as ActivityBody;
		expect(filled.days?.[29]).toEqual({
			day: todayKey,
			delivered: 1,
			failed: 1,
		});
	});

	test("activity rejects a days value other than 30", async () => {
		const id = await createTestWebhook("activity-days-bad");
		const res = await app.request(`/webhooks/${id}/activity?days=7`);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ code: "INVALID_DAYS" });
	});

	// ── list-wide heat data ──────────────────────────────────────────

	type HeatBody = {
		hours: string[];
		webhooks: { id: string; delivered: number[]; failed: number[] }[];
	};

	test("list activity aligns each webhook's counts to the 168 hours and zero-fills the rest", async () => {
		const busy = await createTestWebhook("heat-busy");
		const quiet = await createTestWebhook("heat-quiet");
		const hour = new Date(currentHourStart().getTime() - 3 * 3_600_000);
		const at = new Date(hour.getTime() + 60_000);
		await getDb()
			.insertInto("webhook_deliveries")
			.values([
				{
					webhook_id: busy,
					outbox_id: null,
					attempt: 1,
					status_code: 200,
					dispatched_at: at,
				},
				{
					webhook_id: busy,
					outbox_id: null,
					attempt: 1,
					status_code: 200,
					dispatched_at: at,
				},
				{
					webhook_id: busy,
					outbox_id: null,
					attempt: 1,
					status_code: 502,
					dispatched_at: at,
				},
			])
			.execute();
		const res = await app.request("/webhooks/activity");
		expect(res.status).toBe(200);
		const body = (await res.json()) as HeatBody;
		expect(body.hours).toHaveLength(168);
		const index = body.hours.indexOf(hour.toISOString());
		expect(index).toBe(164);
		const busyRow = body.webhooks.find((w) => w.id === busy);
		expect(busyRow?.delivered).toHaveLength(168);
		expect(busyRow?.delivered[index]).toBe(2);
		expect(busyRow?.failed[index]).toBe(1);
		const quietRow = body.webhooks.find((w) => w.id === quiet);
		expect(quietRow?.delivered.every((n) => n === 0)).toBe(true);
		expect(quietRow?.failed.every((n) => n === 0)).toBe(true);
	});

	test("list activity leaves out another account's webhooks", async () => {
		const mine = await createTestWebhook("heat-mine");
		const theirs = await createTestWebhook("heat-theirs");
		await getDb()
			.updateTable("webhooks")
			.set({ account_id: "a5e10000-0000-4000-8000-0000000000ff" })
			.where("id", "=", theirs)
			.execute();
		const body = (await (
			await app.request("/webhooks/activity")
		).json()) as HeatBody;
		expect(body.webhooks.some((w) => w.id === mine)).toBe(true);
		expect(body.webhooks.some((w) => w.id === theirs)).toBe(false);
	});
});

describe.skipIf(SKIP)("Webhooks API pagination", () => {
	const PAGINATION_ACCOUNT_ID = "a5e10000-0000-4000-8000-000000000010";
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
			.insertInto("accounts")
			.values({
				id: PAGINATION_ACCOUNT_ID,
				email: `${PAGINATION_ACCOUNT_ID}@test.local`,
			})
			.onConflict((oc) => oc.column("id").doNothing())
			.execute();

		// Seed 3 webhooks
		for (let i = 1; i <= 3; i++) {
			await app.request("/webhooks", {
				method: "POST",
				body: JSON.stringify({
					name: `page-sub-${i}`,
					triggers: [{ type: "stx_transfer" }],
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
	});

	test("create uses the tenant-local empty account scope", async () => {
		const created = await app.request("/webhooks", {
			method: "POST",
			body: JSON.stringify({
				name: "dedicated-valid",
				triggers: [{ type: "stx_transfer" }],
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

describe("usual band maths", () => {
	test("nearest-rank percentile picks the ranked sample", () => {
		const values = [5, 1, 9, 3, 7, 2, 8, 4, 10, 6];
		expect(percentileNearestRank(values, 0.1)).toBe(1);
		expect(percentileNearestRank(values, 0.5)).toBe(5);
		expect(percentileNearestRank(values, 0.9)).toBe(9);
		expect(percentileNearestRank([], 0.9)).toBe(0);
	});

	test("the band ignores the current partial hour and hides when the median is below one", () => {
		const now = new Date("2026-10-15T12:34:00.000Z");
		const counts = new Map<string, number>();
		// Only the partial current hour has traffic: still no band.
		counts.set("2026-10-15T12:00:00.000Z", 50);
		expect(usualBand(counts, now)).toBeNull();
	});
});
