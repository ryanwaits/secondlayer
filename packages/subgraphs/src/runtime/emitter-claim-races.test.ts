import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { startEmitter } from "./emitter.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";
const priorAllowEgress = process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS;
process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = "true";

const db = getDb();
const accountId = randomUUID();
const webhookIds: string[] = [];
let stopEmitter: (() => Promise<void>) | null = null;

/** Receiver that holds every response until `release()` is called. */
function startGatedReceiver() {
	const received: { n: number }[] = [];
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const body = JSON.parse(await req.text()) as { data: { n: number } };
			received.push({ n: body.data.n });
			await gate;
			return new Response("ok", { status: 200 });
		},
	});
	return {
		url: `http://localhost:${server.port}`,
		received,
		release: () => release(),
		stop: () => server.stop(),
	};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, ms = 5_000) {
	const start = Date.now();
	while (!check() && Date.now() - start < ms) await sleep(50);
}

beforeAll(async () => {
	stopEmitter = await startEmitter({ pollIntervalMs: 1_000 });
});

afterAll(async () => {
	await stopEmitter?.();
	if (webhookIds.length > 0)
		await db.deleteFrom("webhooks").where("id", "in", webhookIds).execute();
	if (priorAllowEgress === undefined)
		Reflect.deleteProperty(process.env, "SECONDLAYER_ALLOW_PRIVATE_EGRESS");
	else process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = priorAllowEgress;
});

async function seedRow(webhookId: string, n: number, ageMs: number) {
	return db
		.insertInto("webhook_outbox")
		.values({
			webhook_id: webhookId,
			block_height: 1000 + n,
			tx_id: `0x${n}`,
			row_pk: { blockHeight: 1000 + n, txId: `0x${n}`, rowIndex: 0 },
			event_type: "chain.stx_transfer.apply",
			payload: { n },
			dedup_key: `race-${randomUUID().slice(0, 12)}`,
			next_attempt_at: new Date(Date.now() - ageMs),
		})
		.returning("id")
		.executeTakeFirstOrThrow();
}

describe("emitter claim races", () => {
	it("a stale settle does not clear a row another claim now holds", async () => {
		const receiver = startGatedReceiver();
		try {
			const { webhook } = await createWebhook(db, {
				accountId,
				name: `stale-${randomUUID().slice(0, 8)}`,
				triggers: [{ type: "stx_transfer" }],
				url: receiver.url,
				timeoutMs: 10_000,
			});
			webhookIds.push(webhook.id);
			const row = await seedRow(webhook.id, 1, 1_000);
			await waitFor(() => receiver.received.length === 1);
			expect(receiver.received.length).toBe(1);

			// The lock lapsed and a newer claim took the row mid-delivery.
			const newerClaim = "emitter-other:newer-claim";
			await db
				.updateTable("webhook_outbox")
				.set({
					locked_by: newerClaim,
					locked_until: new Date(Date.now() + 600_000),
				})
				.where("id", "=", row.id)
				.execute();

			receiver.release();
			await sleep(1_000);

			const after = await db
				.selectFrom("webhook_outbox")
				.select(["status", "locked_by", "delivered_at", "attempt"])
				.where("id", "=", row.id)
				.executeTakeFirstOrThrow();
			expect(after.status).toBe("pending");
			expect(after.locked_by).toBe(newerClaim);
			expect(after.delivered_at).toBeNull();
			expect(after.attempt).toBe(0);
		} finally {
			receiver.release();
			receiver.stop();
		}
	});

	it("does not send a queued row a reorg killed before its turn", async () => {
		const receiver = startGatedReceiver();
		try {
			const { webhook } = await createWebhook(db, {
				accountId,
				name: `reorged-${randomUUID().slice(0, 8)}`,
				triggers: [{ type: "stx_transfer" }],
				url: receiver.url,
				timeoutMs: 10_000,
				concurrency: 1,
			});
			webhookIds.push(webhook.id);
			await seedRow(webhook.id, 1, 2_000);
			const second = await seedRow(webhook.id, 2, 1_000);
			await waitFor(() => receiver.received.length === 1);
			expect(receiver.received.map((r) => r.n)).toEqual([1]);

			// Row 2 is claimed and waiting in memory behind row 1. A reorg
			// kills it.
			await db
				.updateTable("webhook_outbox")
				.set({
					status: "dead",
					dead_reason: "orphaned",
					failed_at: new Date(),
					last_error: "orphaned by reorg at 999",
					locked_by: null,
					locked_until: null,
				})
				.where("id", "=", second.id)
				.execute();

			receiver.release();
			await sleep(1_500);

			expect(receiver.received.map((r) => r.n)).toEqual([1]);
		} finally {
			receiver.release();
			receiver.stop();
		}
	});
});
