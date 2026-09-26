import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { startEmitter } from "./emitter.ts";

/**
 * Regression coverage for the prod incident where outbox→POST p95 stayed at
 * ~50s under a SUSTAINED stream, even after the burst-redrain fix (which
 * only proved a one-off burst drains without a second wake). A steady
 * arrival rate well under the sub's own dispatch throughput (6 rows/s at
 * concurrency 4, ~100ms/request ≈ 40 rows/s capacity) should never build a
 * backlog — if it does, the claim/dispatch pipeline itself is the problem,
 * not the arrival pattern.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";
process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = "true";

const db = getDb();
const accountId = randomUUID();
let stopEmitter: (() => Promise<void>) | null = null;

const ROWS_PER_TICK = 6;
const TICK_MS = 1_000;
const DURATION_MS = 20_000; // 20 "blocks" — enough to reveal a compounding backlog
const CONCURRENCY = 4;
const RECEIVER_DELAY_MS = 100;
const ABSURDLY_LONG_POLL_MS = 5 * 60_000;

beforeAll(async () => {
	stopEmitter = await startEmitter({ pollIntervalMs: ABSURDLY_LONG_POLL_MS });
});

afterAll(async () => {
	await stopEmitter?.();
	await db.deleteFrom("webhooks").where("account_id", "=", accountId).execute();
});

describe("emitter under a sustained stream well within its own dispatch capacity", () => {
	it("keeps claim-to-POST latency low — arrival rate never exceeds concurrency-bounded throughput", async () => {
		const insertedAt = new Map<string, number>();
		const receivedAt = new Map<string, number>();
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = await req.text();
				await new Promise((r) => setTimeout(r, RECEIVER_DELAY_MS));
				const parsed = JSON.parse(body) as { data: { txId: string } };
				receivedAt.set(parsed.data.txId, Date.now());
				return new Response("ok", { status: 200 });
			},
		});
		try {
			const { webhook } = await createWebhook(db, {
				accountId,
				name: `sustained-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: `http://localhost:${server.port}`,
				timeoutMs: 5_000,
				concurrency: CONCURRENCY,
			});

			let tick = 0;
			const ticks = DURATION_MS / TICK_MS;
			while (tick < ticks) {
				const values = Array.from({ length: ROWS_PER_TICK }, (_, i) => {
					const txId = `0xsustained-${tick}-${i}-${randomUUID().slice(0, 6)}`;
					insertedAt.set(txId, Date.now());
					return {
						webhook_id: webhook.id,
						subgraph_name: "bitcoin",
						table_name: "transfers",
						block_height: tick,
						tx_id: txId,
						row_pk: { blockHeight: tick, txId, rowIndex: i },
						event_type: "bitcoin.transfers.created" as const,
						payload: { sender: "SP1", recipient: "SP2", txId },
						dedup_key: `test-sustained-${tick}-${i}-${randomUUID().slice(0, 6)}`,
					};
				});
				await db.insertInto("webhook_outbox").values(values).execute();
				tick++;
				await new Promise((r) => setTimeout(r, TICK_MS));
			}

			// Give the tail end time to drain.
			const deadline = Date.now() + 10_000;
			while (receivedAt.size < insertedAt.size && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 50));
			}

			expect(receivedAt.size).toBe(insertedAt.size);

			const latencies = [...insertedAt.entries()]
				.map(
					([txId, at]) =>
						(receivedAt.get(txId) ?? Number.POSITIVE_INFINITY) - at,
				)
				.sort((a, b) => a - b);
			const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
			const max = latencies.at(-1) ?? 0;
			console.log("sustained-latency", {
				n: latencies.length,
				p50: latencies[Math.floor(latencies.length * 0.5)],
				p95,
				max,
			});
			expect(p95).toBeLessThan(1_000);
		} finally {
			server.stop();
		}
	}, 45_000);
});
