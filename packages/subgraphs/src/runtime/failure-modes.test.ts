import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { sign, verify } from "@secondlayer/shared/crypto/standard-webhooks";
import { getDb } from "@secondlayer/shared/db";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import { startEmitter } from "./emitter.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/secondlayer";
process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = "true";

const db = getDb();
const accountId = randomUUID();
let stopEmitter: (() => Promise<void>) | null = null;

beforeAll(async () => {
	stopEmitter = await startEmitter({ pollIntervalMs: 500 });
});

afterAll(async () => {
	// Don't closeDb() — see emitter.test.ts comment.
	await stopEmitter?.();
	await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", accountId)
		.execute();
});

describe("failure modes", () => {
	it("receiver-kill mid-batch: all outbox rows reach delivered or pending/dead, none lost", async () => {
		let killAfter = 0;
		const server = Bun.serve({
			port: 0,
			async fetch() {
				killAfter++;
				if (killAfter === 3) {
					// mid-batch: return error (simulate receiver falling over)
					return new Response("internal", { status: 503 });
				}
				return new Response("ok", { status: 200 });
			},
		});
		try {
			const { subscription } = await createSubscription(db, {
				accountId,
				name: `killmid-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: `http://127.0.0.1:${server.port}`,
				timeoutMs: 2_000,
			});
			const total = 5;
			const rows = Array.from({ length: total }, (_, i) => ({
				subscription_id: subscription.id,
				subgraph_name: "bitcoin",
				table_name: "transfers",
				block_height: 100 + i,
				tx_id: `0x${i}`,
				row_pk: { blockHeight: 100 + i, txId: `0x${i}`, rowIndex: 0 },
				event_type: "bitcoin.transfers.created",
				payload: { i },
				dedup_key: `killmid-${randomUUID()}`,
			}));
			await db.insertInto("subscription_outbox").values(rows).execute();

			// Wait for deliveries to settle (or at least all rows touched).
			const deadline = Date.now() + 8_000;
			while (Date.now() < deadline) {
				const outbox = await db
					.selectFrom("subscription_outbox")
					.select(["status", "attempt"])
					.where("subscription_id", "=", subscription.id)
					.execute();
				const allTouched = outbox.every(
					(r) => r.status === "delivered" || r.attempt >= 1,
				);
				if (allTouched) break;
				await new Promise((r) => setTimeout(r, 100));
			}

			const outbox = await db
				.selectFrom("subscription_outbox")
				.selectAll()
				.where("subscription_id", "=", subscription.id)
				.execute();
			expect(outbox.length).toBe(total);
			// No row is stranded in an intermediate state — each was attempted.
			for (const r of outbox) {
				expect(["delivered", "pending", "dead"]).toContain(r.status);
				expect(r.attempt).toBeGreaterThanOrEqual(1);
			}
		} finally {
			server.stop();
		}
	}, 15_000);

	it("tx rollback: outbox inserts within a rolled-back tx leave zero rows", async () => {
		const { subscription } = await createSubscription(db, {
			accountId,
			name: `rollback-${randomUUID().slice(0, 8)}`,
			subgraphName: "bitcoin",
			tableName: "transfers",
			url: "http://127.0.0.1:1",
			timeoutMs: 1_000,
		});
		// Simulate the block-processor tx rolling back mid-flight.
		try {
			await db.transaction().execute(async (tx) => {
				await tx
					.insertInto("subscription_outbox")
					.values({
						subscription_id: subscription.id,
						subgraph_name: "bitcoin",
						table_name: "transfers",
						block_height: 999_999,
						tx_id: "0xrollback",
						row_pk: {
							blockHeight: 999_999,
							txId: "0xrollback",
							rowIndex: 0,
						},
						event_type: "bitcoin.transfers.created",
						payload: { x: 1 },
						dedup_key: `rollback-${randomUUID()}`,
					})
					.execute();
				// Simulate the processor crashing after the insert but before commit.
				throw new Error("SIGKILL");
			});
		} catch (e) {
			expect((e as Error).message).toBe("SIGKILL");
		}
		const outbox = await db
			.selectFrom("subscription_outbox")
			.selectAll()
			.where("subscription_id", "=", subscription.id)
			.where("block_height", "=", 999_999)
			.execute();
		expect(outbox.length).toBe(0);
	});

	it("clock-skew replay attack: verify rejects timestamp beyond tolerance", () => {
		const secret = "whsec_dGVzdC1zZWNyZXQ=";
		const body = '{"type":"x.y.created","data":{}}';
		const now = Math.floor(Date.now() / 1000);
		// Replay from 10 minutes ago — beyond default 5-min tolerance.
		const staleHeaders = sign(body, secret, {
			id: randomUUID(),
			timestampSeconds: now - 10 * 60,
		});
		expect(verify(body, staleHeaders, secret)).toBe(false);
		// Custom tight tolerance also catches a 10s skew.
		const recent = sign(body, secret, {
			id: randomUUID(),
			timestampSeconds: now - 15,
		});
		expect(verify(body, recent, secret, { toleranceSeconds: 5 })).toBe(false);
		// Fresh delivery verifies fine.
		const fresh = sign(body, secret, { id: randomUUID() });
		expect(verify(body, fresh, secret)).toBe(true);
	});
});
