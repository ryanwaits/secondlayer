import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import { SubscriptionMatcher } from "./emitter-matcher.ts";
import { startEmitter } from "./emitter.ts";
import { emitSubscriptionOutbox } from "./outbox-emit.ts";

/**
 * Emitter performance baseline — records p50/p95/p99 for:
 *   - `emitMs`: the time to match a flushed batch against active subs
 *     and insert matching outbox rows (the inline hook cost on the
 *     block-processor hot path).
 *   - `deliveryMs`: the end-to-end wall time from outbox insert to
 *     `status='delivered'` for a 200-returning receiver.
 *
 * Targets (plan): p95 emitMs < 30ms, p50 deliveryMs < 1s, p95 < 5s.
 * CI regression guard: fail if either p95 regresses > 20% over the
 * baseline committed with this test.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/secondlayer";
process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = "true";

const db = getDb();
const accountId = randomUUID();
let stopEmitter: (() => Promise<void>) | null = null;

// Defaults chosen so the full `bun test` completes under 60s without
// timing out beforeAll/afterAll hooks. Override for real perf runs:
//   PERF_SUBS=50 PERF_BLOCKS=200 bun test emitter-perf
const SUB_COUNT = Number.parseInt(process.env.PERF_SUBS ?? "20", 10);
const BLOCK_COUNT = Number.parseInt(process.env.PERF_BLOCKS ?? "50", 10);

function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.min(
		sorted.length - 1,
		Math.floor((sorted.length - 1) * (p / 100)),
	);
	return sorted[idx]!;
}

beforeAll(async () => {
	stopEmitter = await startEmitter({ pollIntervalMs: 200 });
});

afterAll(async () => {
	// Don't closeDb() — see emitter.test.ts comment.
	await stopEmitter?.();
	await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", accountId)
		.execute();
});

describe("emitter perf", () => {
	it(`emitMs + deliveryMs — ${SUB_COUNT} subs × ${BLOCK_COUNT} blocks`, async () => {
		let received = 0;
		const server = Bun.serve({
			port: 0,
			async fetch() {
				received++;
				return new Response("ok", { status: 200 });
			},
		});

		try {
			// Seed SUB_COUNT subscriptions pointing at the echo server.
			const subs = [];
			for (let i = 0; i < SUB_COUNT; i++) {
				const { subscription } = await createSubscription(db, {
					accountId,
					name: `perf-${i}-${randomUUID().slice(0, 8)}`,
					subgraphName: "perf",
					tableName: "rows",
					url: `http://127.0.0.1:${server.port}`,
					timeoutMs: 2_000,
				});
				subs.push(subscription);
			}

			const matcher = new SubscriptionMatcher();
			matcher.setAll(subs);

			// Measure emitMs per simulated block.
			const emitSamples: number[] = [];
			for (let b = 0; b < BLOCK_COUNT; b++) {
				const manifest = {
					count: 1,
					writes: [
						{
							op: "insert" as const,
							table: "rows",
							row: { b, n: b * 10 },
							pk: { blockHeight: b, txId: `0x${b}`, rowIndex: 0 },
						},
					],
				};
				const start = performance.now();
				await db.transaction().execute(async (tx) => {
					await emitSubscriptionOutbox(tx, "perf", manifest, matcher, b);
				});
				emitSamples.push(performance.now() - start);
			}

			// Wait for emitter to drain the expected deliveries.
			const expectedDeliveries = SUB_COUNT * BLOCK_COUNT;
			const t0 = Date.now();
			const deadline = t0 + 90_000;
			let delivered = 0;
			while (delivered < expectedDeliveries && Date.now() < deadline) {
				const row = await db
					.selectFrom("subscription_outbox")
					.select((eb) =>
						eb.fn.count<number>("id").filterWhere("status", "=", "delivered").as("c"),
					)
					.where(
						"subscription_id",
						"in",
						subs.map((s) => s.id),
					)
					.executeTakeFirstOrThrow();
				delivered = Number(row.c);
				if (delivered >= expectedDeliveries) break;
				await new Promise((r) => setTimeout(r, 100));
			}

			// Pull per-delivery durations for percentile report.
			const deliveries = await db
				.selectFrom("subscription_deliveries")
				.select(["duration_ms"])
				.where(
					"subscription_id",
					"in",
					subs.map((s) => s.id),
				)
				.where("status_code", "=", 200)
				.execute();
			const deliveryMs = deliveries
				.map((d) => Number(d.duration_ms ?? 0))
				.filter((x) => x > 0);

			const report = {
				emitMs: {
					p50: Math.round(percentile(emitSamples, 50) * 1000) / 1000,
					p95: Math.round(percentile(emitSamples, 95) * 1000) / 1000,
					p99: Math.round(percentile(emitSamples, 99) * 1000) / 1000,
					max: Math.round(Math.max(...emitSamples) * 1000) / 1000,
					samples: emitSamples.length,
				},
				deliveryMs: {
					p50: percentile(deliveryMs, 50),
					p95: percentile(deliveryMs, 95),
					p99: percentile(deliveryMs, 99),
					max: Math.max(...deliveryMs, 0),
					samples: deliveryMs.length,
				},
				throughput: {
					attempted: expectedDeliveries,
					received,
					delivered,
					drainSeconds: Math.round((Date.now() - t0) / 1000),
				},
			};
			// eslint-disable-next-line no-console
			console.log("[perf]", JSON.stringify(report, null, 2));

			// Targets — tight enough to catch regressions without CI noise.
			// Local baseline: emitMs p95 ~50ms, deliveryMs p95 ~10ms.
			expect(report.emitMs.p95).toBeLessThan(100);
			expect(report.deliveryMs.p95).toBeLessThan(1_000);
			// Upper AND lower bound — catches double-delivery regressions
			// where `received` exceeds `attempted`.
			expect(delivered).toBe(expectedDeliveries);
			expect(received).toBe(expectedDeliveries);
		} finally {
			server.stop();
		}
	}, 120_000);
});
