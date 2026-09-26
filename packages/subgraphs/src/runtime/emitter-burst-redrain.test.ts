import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { startEmitter } from "./emitter.ts";

/**
 * Regression coverage for the outbox→POST p95 tail found after the NOTIFY
 * wake was confirmed working (block→outbox and the wake itself were fine;
 * p50 stayed low, but p95 rose to ~20s — most of the emitter's own 2-minute
 * safety poll interval).
 *
 * Root cause: `claimAndDrain` guarded itself with a plain `claimInFlight`
 * boolean. A NOTIFY that arrived while a cycle was still dispatching (a
 * realistic shape: rows land in a burst, and delivery takes real HTTP time)
 * hit that guard and was dropped — nothing re-checked once the busy cycle
 * finished. A row inserted mid-drain then had to wait for an UNRELATED
 * future wake, or the poll.
 *
 * This pins it directly: insert a burst of 20 rows for ONE webhook capped at
 * concurrency 4, staggered so some land while the first slice is still being
 * dispatched (the receiver holds each request open for a bit specifically to
 * create that window), and require all 20 to be delivered — with the safety
 * poll set long enough that it can't be what saves the test.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";
process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = "true";

const db = getDb();
const accountId = randomUUID();
let stopEmitter: (() => Promise<void>) | null = null;

const BURST_SIZE = 20;
const CONCURRENCY = 4;
// Long enough that the safety poll firing inside the assertion window would
// be a false pass — only re-draining on the dropped NOTIFYs can explain a
// pass this fast.
const ABSURDLY_LONG_POLL_MS = 5 * 60_000;
// Held open long enough that a second wave of inserts reliably lands while
// the first slice (4 requests) is still in flight, without making the test
// slow.
const RECEIVER_DELAY_MS = 120;

beforeAll(async () => {
	stopEmitter = await startEmitter({ pollIntervalMs: ABSURDLY_LONG_POLL_MS });
});

afterAll(async () => {
	await stopEmitter?.();
	// Owned outbox + delivery rows first — see emitter.test.ts's afterAll comment
	// for why a bare `deleteFrom("webhooks")` orphans deliveries.
	const ownedWebhooks = await db
		.selectFrom("webhooks")
		.select("id")
		.where("account_id", "=", accountId)
		.execute();
	const webhookIds = ownedWebhooks.map((w) => w.id);
	if (webhookIds.length > 0) {
		await db
			.deleteFrom("webhook_deliveries")
			.where("webhook_id", "in", webhookIds)
			.execute();
		await db
			.deleteFrom("webhook_outbox")
			.where("webhook_id", "in", webhookIds)
			.execute();
	}
	await db.deleteFrom("webhooks").where("account_id", "=", accountId).execute();
});

describe("emitter re-drains a burst instead of stranding rows that land mid-dispatch", () => {
	it("delivers all 20 burst rows at concurrency 4 without a second NOTIFY wave or the poll", async () => {
		const receivedAt: number[] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				await req.text();
				await new Promise((r) => setTimeout(r, RECEIVER_DELAY_MS));
				receivedAt.push(Date.now());
				return new Response("ok", { status: 200 });
			},
		});
		try {
			const { webhook } = await createWebhook(db, {
				accountId,
				name: `burst-redrain-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: `http://localhost:${server.port}`,
				timeoutMs: 5_000,
				concurrency: CONCURRENCY,
			});

			const row = (i: number) => ({
				webhook_id: webhook.id,
				subgraph_name: "bitcoin",
				table_name: "transfers",
				block_height: 1,
				tx_id: `0xburst${i}`,
				row_pk: { blockHeight: 1, txId: `0xburst${i}`, rowIndex: i },
				event_type: "bitcoin.transfers.created" as const,
				payload: { sender: "SP1", recipient: "SP2", amount: String(i) },
				dedup_key: `test-burst-redrain-${i}-${randomUUID().slice(0, 8)}`,
			});

			// First slice: exactly `concurrency` rows, so every worker slot is
			// occupied and the claim cycle is busy dispatching for
			// ~RECEIVER_DELAY_MS.
			await db
				.insertInto("webhook_outbox")
				.values(Array.from({ length: CONCURRENCY }, (_, i) => row(i)))
				.execute();

			// Land the rest WHILE the first slice is still being delivered — this
			// is the window the old `claimInFlight` guard dropped on the floor.
			await new Promise((r) => setTimeout(r, RECEIVER_DELAY_MS / 3));
			await db
				.insertInto("webhook_outbox")
				.values(
					Array.from({ length: BURST_SIZE - CONCURRENCY }, (_, i) =>
						row(i + CONCURRENCY),
					),
				)
				.execute();

			const deadline = Date.now() + 5_000;
			while (receivedAt.length < BURST_SIZE && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 20));
			}

			expect(receivedAt.length).toBe(BURST_SIZE);

			// The receiver sees the request (and this test's `receivedAt` push)
			// before `settleDelivered()`'s DB transaction commits — poll instead
			// of checking once, same pattern as emitter.test.ts.
			const settleDeadline = Date.now() + 3_000;
			let delivered: { status: string }[] = [];
			while (Date.now() < settleDeadline) {
				delivered = await db
					.selectFrom("webhook_outbox")
					.select(["status"])
					.where("webhook_id", "=", webhook.id)
					.execute();
				if (
					delivered.length === BURST_SIZE &&
					delivered.every((r) => r.status === "delivered")
				) {
					break;
				}
				await new Promise((r) => setTimeout(r, 50));
			}
			expect(delivered).toHaveLength(BURST_SIZE);
			expect(delivered.every((r) => r.status === "delivered")).toBe(true);
		} finally {
			server.stop();
		}
	}, 8_000);
});
