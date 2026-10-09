import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { logger } from "@secondlayer/shared/logger";
import { startEmitter } from "./emitter.ts";

/**
 * Plan 067 found: `stopEmitter()` returned before in-flight deliveries
 * finished. A POST mid-flight at shutdown wrote its `webhook_deliveries` row
 * AFTER the emitter reported "stopped" — a delivery-during-restart race in
 * prod, and the source of the stray rows plan 067's test afterAlls had to
 * clean up by hand.
 *
 * This pins the fix directly: stop must not resolve until the current claim
 * pass and every in-flight dispatch have settled (bounded by
 * `stopDrainDeadlineMs`, so a receiver that never responds can't hang
 * shutdown forever — see the third case below).
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";
process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = "true";

const db = getDb();
const accountId = randomUUID();

// Long enough that this test's own assertion windows could never be
// satisfied by the safety poll firing — only the explicit stop() call
// (and, in the last case, the deadline it's given) drives the timing here.
const ABSURDLY_LONG_POLL_MS = 5 * 60_000;

// By id, not account: OSS mode stores every webhook with account_id "".
const webhookIds: string[] = [];

afterAll(async () => {
	// webhook_outbox and webhook_deliveries both cascade on webhook delete
	// (migration 0140 added the FK for deliveries) — one cleanup path.
	if (webhookIds.length === 0) return;
	await db.deleteFrom("webhooks").where("id", "in", webhookIds).execute();
});

async function waitFor(
	check: () => boolean,
	timeoutMs: number,
	stepMs = 10,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check() && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, stepMs));
	}
}

describe("stopEmitter waits for in-flight work before resolving", () => {
	it("waits for a mid-flight dispatch's delivery row to be written before resolving", async () => {
		const RECEIVER_DELAY_MS = 500;
		let receivedCount = 0;
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				await req.text();
				receivedCount++;
				await new Promise((r) => setTimeout(r, RECEIVER_DELAY_MS));
				return new Response("ok", { status: 200 });
			},
		});

		const stopEmitter = await startEmitter({
			pollIntervalMs: ABSURDLY_LONG_POLL_MS,
		});
		try {
			const { webhook } = await createWebhook(db, {
				accountId,
				name: `clean-stop-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: `http://localhost:${server.port}`,
				timeoutMs: 5_000,
				concurrency: 1,
			});
			webhookIds.push(webhook.id);

			await db
				.insertInto("webhook_outbox")
				.values({
					webhook_id: webhook.id,
					subgraph_name: "bitcoin",
					table_name: "transfers",
					block_height: 1,
					tx_id: "0xcleanstop",
					row_pk: { blockHeight: 1, txId: "0xcleanstop", rowIndex: 0 },
					event_type: "bitcoin.transfers.created" as const,
					payload: { sender: "SP1", recipient: "SP2", amount: "1" },
					dedup_key: `test-clean-stop-${randomUUID().slice(0, 8)}`,
				})
				.execute();

			// Wait for the receiver to have been hit — the dispatch is now mid
			// `RECEIVER_DELAY_MS`-sleep, holding its `runOne` promise open.
			await waitFor(() => receivedCount === 1, 3_000);
			expect(receivedCount).toBe(1);

			// Confirm the race this pins: at this instant the delivery row does
			// NOT exist yet (it's only written after the POST resolves).
			const beforeStop = await db
				.selectFrom("webhook_deliveries")
				.select("id")
				.where("webhook_id", "=", webhook.id)
				.execute();
			expect(beforeStop.length).toBe(0);

			const stopStarted = Date.now();
			await stopEmitter();
			const stopElapsedMs = Date.now() - stopStarted;

			// Proves stop() actually waited out the in-flight HTTP call rather
			// than returning immediately.
			expect(stopElapsedMs).toBeGreaterThanOrEqual(RECEIVER_DELAY_MS - 50);

			// (a) + (b): the delivery row exists by the time stop() resolves —
			// i.e. the insert happened BEFORE "stopped", never after. (Not checked
			// via `dispatched_at` vs `Date.now()`: that compares the database's
			// clock with this process's, and a 1ms skew fails it.)
			const afterStop = await db
				.selectFrom("webhook_deliveries")
				.select("id")
				.where("webhook_id", "=", webhook.id)
				.execute();
			expect(afterStop.length).toBe(1);
		} finally {
			server.stop(true);
		}
	}, 15_000);

	it("bounds the drain and reports the abandoned dispatch when a receiver never responds", async () => {
		const STOP_DEADLINE_MS = 300;
		let receivedCount = 0;
		// Held past the stop deadline to pin the abandon path, then released in
		// `finally` so the abandoned dispatch settles before cleanup runs.
		let releaseReceiver = () => {};
		const receiverHeld = new Promise<void>((resolve) => {
			releaseReceiver = resolve;
		});
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				await req.text();
				receivedCount++;
				await receiverHeld;
				return new Response("ok", { status: 200 });
			},
		});
		let outboxId: string | undefined;

		const stopEmitter = await startEmitter({
			pollIntervalMs: ABSURDLY_LONG_POLL_MS,
			stopDrainDeadlineMs: STOP_DEADLINE_MS,
		});
		const infoSpy = spyOn(logger, "info");
		try {
			const { webhook } = await createWebhook(db, {
				accountId,
				name: `clean-stop-hang-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: `http://localhost:${server.port}`,
				// Longer than STOP_DEADLINE_MS so the webhook's own HTTP timeout
				// never fires first — the assertion below is about stopEmitter's
				// bound, not dispatchOne's.
				timeoutMs: 10_000,
				concurrency: 1,
			});
			webhookIds.push(webhook.id);

			const outbox = await db
				.insertInto("webhook_outbox")
				.values({
					webhook_id: webhook.id,
					subgraph_name: "bitcoin",
					table_name: "transfers",
					block_height: 1,
					tx_id: "0xcleanstophang",
					row_pk: { blockHeight: 1, txId: "0xcleanstophang", rowIndex: 0 },
					event_type: "bitcoin.transfers.created" as const,
					payload: { sender: "SP1", recipient: "SP2", amount: "1" },
					dedup_key: `test-clean-stop-hang-${randomUUID().slice(0, 8)}`,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			outboxId = outbox.id;

			await waitFor(() => receivedCount === 1, 3_000);
			expect(receivedCount).toBe(1);

			const stopStarted = Date.now();
			await stopEmitter();
			const stopElapsedMs = Date.now() - stopStarted;

			// Resolves at ~the bound, not left hanging on the stuck receiver.
			expect(stopElapsedMs).toBeGreaterThanOrEqual(STOP_DEADLINE_MS - 50);
			expect(stopElapsedMs).toBeLessThan(STOP_DEADLINE_MS + 3_000);

			const stoppedCall = infoSpy.mock.calls.find(
				(call) => call[0] === "[emitter] stopped",
			);
			expect(stoppedCall).toBeDefined();
			expect(stoppedCall?.[1]).toMatchObject({
				event: "emitter_stopped",
				drained: 0,
				abandoned: 1,
			});

			// The abandoned dispatch never got to write its delivery row.
			const deliveries = await db
				.selectFrom("webhook_deliveries")
				.select("id")
				.where("webhook_id", "=", webhook.id)
				.execute();
			expect(deliveries.length).toBe(0);
		} finally {
			infoSpy.mockRestore();
			// The abandoned dispatch outlives stop(). Let it finish, then wait for
			// its settle transaction (outbox row, then webhooks row) to commit:
			// afterAll's webhook delete locks those rows in the opposite order via
			// the outbox FK cascade, so racing it deadlocks. The delivery row is
			// written before that transaction, so it can't be the signal.
			releaseReceiver();
			const deadline = Date.now() + 5_000;
			while (outboxId && Date.now() < deadline) {
				const row = await db
					.selectFrom("webhook_outbox")
					.select("status")
					.where("id", "=", outboxId)
					.executeTakeFirst();
				if (row?.status !== "pending") break;
				await new Promise((r) => setTimeout(r, 25));
			}
			server.stop(true);
		}
	}, 15_000);
});
