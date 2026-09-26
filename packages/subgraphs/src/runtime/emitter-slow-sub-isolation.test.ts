import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { startEmitter } from "./emitter.ts";

/**
 * Regression coverage for the prod incident where outbox→POST p95 stayed
 * high (~50s) even after the burst-redrain fix, on an emitter serving
 * multiple tenants' webhooks. Root cause: `claimAndDispatchOnce` claims a
 * batch spanning EVERY sub with pending rows, dispatches each sub's slice
 * concurrently (`Promise.all(subIds.map(drainForSub))`), but the
 * process-wide `claimInFlight` lock — and so the NEXT claim, for ANY sub,
 * including a fast one with fresh rows — doesn't release until the
 * SLOWEST sub in that batch finishes. One tenant's slow or hanging
 * receiver holds up every other tenant sharing the emitter.
 *
 * This pins it directly: a slow webhook (receiver takes ~2s/request) and a
 * fast one (~80ms/request) both get rows claimed in the same pass. The fast
 * webhook's rows must not wait on the slow one's dispatch.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";
process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = "true";

const db = getDb();
const accountId = randomUUID();
let stopEmitter: (() => Promise<void>) | null = null;

const ABSURDLY_LONG_POLL_MS = 5 * 60_000;
const SLOW_RECEIVER_DELAY_MS = 2_000;
const FAST_RECEIVER_DELAY_MS = 80;

beforeAll(async () => {
	stopEmitter = await startEmitter({ pollIntervalMs: ABSURDLY_LONG_POLL_MS });
});

afterAll(async () => {
	await stopEmitter?.();
	await db.deleteFrom("webhooks").where("account_id", "=", accountId).execute();
});

describe("a slow webhook's dispatch must not delay an unrelated fast webhook's claim", () => {
	it("the fast webhook's row is delivered promptly while the slow one is still dispatching", async () => {
		const slowReceived: number[] = [];
		const fastReceived: number[] = [];
		const slowServer = Bun.serve({
			port: 0,
			async fetch(req) {
				await req.text();
				await new Promise((r) => setTimeout(r, SLOW_RECEIVER_DELAY_MS));
				slowReceived.push(Date.now());
				return new Response("ok", { status: 200 });
			},
		});
		const fastServer = Bun.serve({
			port: 0,
			async fetch(req) {
				await req.text();
				await new Promise((r) => setTimeout(r, FAST_RECEIVER_DELAY_MS));
				fastReceived.push(Date.now());
				return new Response("ok", { status: 200 });
			},
		});
		try {
			const { webhook: slowWebhook } = await createWebhook(db, {
				accountId,
				name: `slow-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: `http://localhost:${slowServer.port}`,
				timeoutMs: 10_000,
				concurrency: 2,
			});
			const { webhook: fastWebhook } = await createWebhook(db, {
				accountId,
				name: `fast-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: `http://localhost:${fastServer.port}`,
				timeoutMs: 5_000,
				concurrency: 4,
			});

			// Insert the slow row FIRST and give it time to be claimed and its
			// dispatch to actually start (the receiver hasn't responded yet —
			// it's mid-2s-sleep). THEN insert the fast row: this is the case
			// that matters — a fresh claim is needed WHILE the slow row's
			// dispatch is in flight and the process-wide claim lock is held.
			await db
				.insertInto("webhook_outbox")
				.values({
					webhook_id: slowWebhook.id,
					subgraph_name: "bitcoin",
					table_name: "transfers",
					block_height: 1,
					tx_id: "0xslow",
					row_pk: { blockHeight: 1, txId: "0xslow", rowIndex: 0 },
					event_type: "bitcoin.transfers.created" as const,
					payload: { sender: "SP1", recipient: "SP2", amount: "1" },
					dedup_key: `test-slow-${randomUUID().slice(0, 8)}`,
				})
				.execute();
			// Long enough that the slow row is claimed and its HTTP request is
			// underway, short enough that it hasn't resolved yet (2s delay).
			await new Promise((r) => setTimeout(r, 300));

			const insertedAt = Date.now();
			await db
				.insertInto("webhook_outbox")
				.values({
					webhook_id: fastWebhook.id,
					subgraph_name: "bitcoin",
					table_name: "transfers",
					block_height: 1,
					tx_id: "0xfast",
					row_pk: { blockHeight: 1, txId: "0xfast", rowIndex: 0 },
					event_type: "bitcoin.transfers.created" as const,
					payload: { sender: "SP3", recipient: "SP4", amount: "1" },
					dedup_key: `test-fast-${randomUUID().slice(0, 8)}`,
				})
				.execute();

			const deadline = Date.now() + 3_000;
			while (fastReceived.length === 0 && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 20));
			}

			expect(fastReceived.length).toBe(1);
			const fastLatency =
				(fastReceived[0] ?? Number.POSITIVE_INFINITY) - insertedAt;
			// The fast webhook's own dispatch is ~80ms; if it were stuck behind
			// the slow webhook's 2s dispatch, this would be >= ~2000ms.
			expect(fastLatency).toBeLessThan(1_000);
		} finally {
			slowServer.stop();
			fastServer.stop();
		}
	}, 10_000);
});
