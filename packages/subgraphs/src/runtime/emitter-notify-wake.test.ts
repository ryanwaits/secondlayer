import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { startEmitter } from "./emitter.ts";

/**
 * Regression coverage for the prod incident on plan-063's Phase 3 rollout:
 * outbox→POST latency ballooned toward the emitter's safety-net poll
 * interval, suggesting its `webhooks:new_outbox` LISTEN wake had stopped
 * firing and every delivery was waiting on the poll instead.
 *
 * This pins the wake path directly: start the emitter with an absurdly long
 * poll interval (a real poll firing inside the assertion window would be a
 * false pass) and prove a fresh outbox row still gets claimed and delivered
 * in well under a second — that can only happen via NOTIFY.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";
process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = "true";

const db = getDb();
const accountId = randomUUID();
let stopEmitter: (() => Promise<void>) | null = null;

// Long enough that this test's own assertion window (well under a second)
// could never be satisfied by the poll firing — only a NOTIFY wake can.
const ABSURDLY_LONG_POLL_MS = 5 * 60_000;

beforeAll(async () => {
	stopEmitter = await startEmitter({ pollIntervalMs: ABSURDLY_LONG_POLL_MS });
});

afterAll(async () => {
	await stopEmitter?.();
	await db.deleteFrom("webhooks").where("account_id", "=", accountId).execute();
});

describe("emitter NOTIFY wake (not the safety poll)", () => {
	it("delivers a fresh outbox row in well under a second with the safety poll effectively disabled", async () => {
		const received: number[] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				await req.text();
				received.push(Date.now());
				return new Response("ok", { status: 200 });
			},
		});
		try {
			const { webhook } = await createWebhook(db, {
				accountId,
				name: `notify-wake-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: `http://localhost:${server.port}`,
				timeoutMs: 5_000,
			});

			const insertedAt = Date.now();
			await db
				.insertInto("webhook_outbox")
				.values({
					webhook_id: webhook.id,
					subgraph_name: "bitcoin",
					table_name: "transfers",
					block_height: 1,
					tx_id: "0xnotifywake",
					row_pk: { blockHeight: 1, txId: "0xnotifywake", rowIndex: 0 },
					event_type: "bitcoin.transfers.created",
					payload: { sender: "SP1", recipient: "SP2", amount: "1" },
					dedup_key: `test-notify-wake-${randomUUID().slice(0, 12)}`,
				})
				.execute();

			const deadline = Date.now() + 1_000;
			while (received.length === 0 && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 20));
			}

			expect(received.length).toBeGreaterThanOrEqual(1);
			const wakeLatencyMs =
				(received[0] ?? Number.POSITIVE_INFINITY) - insertedAt;
			expect(wakeLatencyMs).toBeLessThan(1_000);
		} finally {
			server.stop();
		}
	}, 5_000);
});
