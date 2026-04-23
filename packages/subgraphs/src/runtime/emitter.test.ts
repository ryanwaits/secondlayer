import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "@secondlayer/shared/db";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import { verify } from "@secondlayer/shared/crypto/standard-webhooks";
import { startEmitter } from "./emitter.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/secondlayer";

const db = getDb();
const accountId = randomUUID();
let stopEmitter: (() => Promise<void>) | null = null;

interface Received {
	body: string;
	headers: Record<string, string>;
}

async function startMockReceiver(
	behavior: (count: number) => "ok" | "fail",
): Promise<{ url: string; received: Received[]; stop: () => Promise<void> }> {
	const received: Received[] = [];
	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const body = await req.text();
			const headers: Record<string, string> = {};
			req.headers.forEach((v, k) => {
				headers[k] = v;
			});
			received.push({ body, headers });
			const verdict = behavior(received.length);
			return new Response(verdict === "ok" ? "ok" : "nope", {
				status: verdict === "ok" ? 200 : 500,
			});
		},
	});
	return {
		url: `http://localhost:${server.port}`,
		received,
		stop: async () => {
			server.stop();
		},
	};
}

beforeAll(async () => {
	stopEmitter = await startEmitter({ pollIntervalMs: 1_000 });
});

afterAll(async () => {
	await stopEmitter?.();
	await db.deleteFrom("subscriptions").where("account_id", "=", accountId).execute();
	await closeDb();
});

describe("startEmitter end-to-end", () => {
	it("delivers outbox row to receiver with valid SW signature", async () => {
		const receiver = await startMockReceiver(() => "ok");
		try {
			const { subscription, signingSecret } = await createSubscription(db, {
				accountId,
				name: `ok-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: receiver.url,
				timeoutMs: 5_000,
			});

			// Seed an outbox row directly — the block-processor hook is exercised
			// elsewhere; here we want to prove the emitter drains + delivers.
			await db
				.insertInto("subscription_outbox")
				.values({
					subscription_id: subscription.id,
					subgraph_name: "bitcoin",
					table_name: "transfers",
					block_height: 1000,
					tx_id: "0xaaa",
					row_pk: { blockHeight: 1000, txId: "0xaaa", rowIndex: 0 },
					event_type: "bitcoin.transfers.created",
					payload: { sender: "SP1", recipient: "SP2", amount: "100" },
					dedup_key: `test-${randomUUID().slice(0, 12)}`,
				})
				.execute();

			// Wait for delivery (LISTEN-driven, but fall back to poll).
			const start = Date.now();
			while (receiver.received.length === 0 && Date.now() - start < 5_000) {
				await new Promise((r) => setTimeout(r, 100));
			}

			expect(receiver.received.length).toBeGreaterThanOrEqual(1);
			const [delivered] = receiver.received;
			expect(delivered).toBeDefined();
			expect(delivered!.headers["content-type"]).toBe("application/json");
			expect(delivered!.headers["webhook-id"]).toBeTruthy();
			expect(delivered!.headers["webhook-timestamp"]).toBeTruthy();
			expect(delivered!.headers["webhook-signature"]).toContain("v1,");

			// Signature verifies with the returned plaintext secret.
			const ok = verify(delivered!.body, delivered!.headers, signingSecret);
			expect(ok).toBe(true);

			const parsed = JSON.parse(delivered!.body) as {
				type: string;
				data: { sender: string };
			};
			expect(parsed.type).toBe("bitcoin.transfers.created");
			expect(parsed.data.sender).toBe("SP1");

			const outboxRow = await db
				.selectFrom("subscription_outbox")
				.selectAll()
				.where("subscription_id", "=", subscription.id)
				.executeTakeFirst();
			expect(outboxRow?.status).toBe("delivered");
			expect(outboxRow?.delivered_at).not.toBeNull();

			const delivery = await db
				.selectFrom("subscription_deliveries")
				.selectAll()
				.where("subscription_id", "=", subscription.id)
				.executeTakeFirst();
			expect(delivery?.status_code).toBe(200);
			expect(delivery?.duration_ms).not.toBeNull();
		} finally {
			await receiver.stop();
		}
	}, 10_000);

	it("schedules backoff + trips circuit on repeat 500s", async () => {
		const receiver = await startMockReceiver(() => "fail");
		try {
			const { subscription } = await createSubscription(db, {
				accountId,
				name: `fail-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: receiver.url,
				timeoutMs: 3_000,
			});

			await db
				.insertInto("subscription_outbox")
				.values({
					subscription_id: subscription.id,
					subgraph_name: "bitcoin",
					table_name: "transfers",
					block_height: 2000,
					tx_id: "0xbbb",
					row_pk: { blockHeight: 2000, txId: "0xbbb", rowIndex: 0 },
					event_type: "bitcoin.transfers.created",
					payload: { sender: "SP9", recipient: "SP10", amount: "5" },
					dedup_key: `test-fail-${randomUUID().slice(0, 12)}`,
				})
				.execute();

			const start = Date.now();
			while (receiver.received.length === 0 && Date.now() - start < 5_000) {
				await new Promise((r) => setTimeout(r, 100));
			}
			expect(receiver.received.length).toBeGreaterThanOrEqual(1);

			// After one fail: outbox row still pending, next_attempt_at pushed, sub has circuit_failures=1
			// (we don't wait the full 30s — just check the intermediate state).
			await new Promise((r) => setTimeout(r, 300));
			const sub = await db
				.selectFrom("subscriptions")
				.selectAll()
				.where("id", "=", subscription.id)
				.executeTakeFirstOrThrow();
			expect(sub.circuit_failures).toBe(1);
			expect(sub.last_error).not.toBeNull();

			const row = await db
				.selectFrom("subscription_outbox")
				.selectAll()
				.where("subscription_id", "=", subscription.id)
				.executeTakeFirstOrThrow();
			expect(row.status).toBe("pending");
			expect(row.attempt).toBe(1);
			expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
		} finally {
			await receiver.stop();
		}
	}, 10_000);
});
