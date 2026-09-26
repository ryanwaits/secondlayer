import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import {
	createWebhook,
	notifyWebhooksChanged,
	toggleWebhookStatus,
} from "@secondlayer/shared/db/queries/webhooks";
import { startEmitter } from "./emitter.ts";

/**
 * Regression coverage for the "stuck rows" prod incident: 4 rows created
 * while a webhook was paused stayed `pending` forever, re-claimed by the
 * safety poll every ~120s but never dispatched or settled.
 *
 * Root cause: a row claimed for a sub that turns out to be paused (status
 * read fresh, after the claim) was silently abandoned — `next_attempt_at`
 * pushed into the future by the claim, `locked_by`/`locked_until` set, but
 * never released, dispatched, or settled. The row only became re-claimable
 * once its stale lock's `LOCK_WINDOW_MS` happened to expire, and every
 * re-claim repeated the same silent abandonment for as long as the webhook
 * stayed paused — resuming it did nothing to speed that up, since nothing
 * triggered a fresh claim on `webhooks:changed` either.
 *
 * This pins it directly: pause a webhook, insert rows, resume — with the
 * safety poll set long enough that its firing inside the assertion window
 * would be a false pass.
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

describe("a webhook's rows inserted while paused drain promptly once resumed", () => {
	it("delivers all rows within a few seconds of resume, without the safety poll", async () => {
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
				name: `paused-resume-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: `http://localhost:${server.port}`,
				timeoutMs: 5_000,
				concurrency: 4,
			});

			await toggleWebhookStatus(db, accountId, webhook.id, "paused");

			await db
				.insertInto("webhook_outbox")
				.values(
					Array.from({ length: 4 }, (_, i) => ({
						webhook_id: webhook.id,
						subgraph_name: "bitcoin",
						table_name: "transfers",
						block_height: 1,
						tx_id: `0xpaused${i}`,
						row_pk: { blockHeight: 1, txId: `0xpaused${i}`, rowIndex: i },
						event_type: "bitcoin.transfers.created" as const,
						payload: { sender: "SP1", recipient: "SP2", amount: String(i) },
						dedup_key: `test-paused-resume-${i}-${randomUUID().slice(0, 8)}`,
					})),
				)
				.execute();

			// Give the (doomed, pre-fix) claim-while-paused cycle a moment to run
			// and NOT dispatch anything.
			await new Promise((r) => setTimeout(r, 300));
			expect(received.length).toBe(0);

			await toggleWebhookStatus(db, accountId, webhook.id, "active");
			await notifyWebhooksChanged(db, accountId);

			const deadline = Date.now() + 5_000;
			while (received.length < 4 && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 50));
			}

			expect(received.length).toBe(4);

			const rows = await db
				.selectFrom("webhook_outbox")
				.select(["status"])
				.where("webhook_id", "=", webhook.id)
				.execute();
			expect(rows).toHaveLength(4);
			expect(rows.every((r) => r.status === "delivered")).toBe(true);
		} finally {
			server.stop();
		}
	}, 10_000);
});
