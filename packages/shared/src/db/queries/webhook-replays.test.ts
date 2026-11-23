import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "../index.ts";
import type { WebhookReplay } from "../types.ts";
import {
	WEBHOOK_REPLAY_MACHINE,
	failScan,
	finalizeReplays,
	finishScan,
	progressOf,
} from "./webhook-replays.ts";
import { createWebhook } from "./webhooks.ts";

function record(over: Partial<WebhookReplay> = {}): WebhookReplay {
	return {
		id: "0123456789abcdef",
		webhook_id: "00000000-0000-0000-0000-000000000001",
		from_block: 100,
		to_block: 200,
		status: "running",
		scanned_count: 5,
		enqueued_count: 9,
		total: null,
		delivered: null,
		gave_up: null,
		error: null,
		started_at: new Date("2026-10-18T10:00:00Z"),
		finished_at: null,
		...over,
	};
}

describe("progressOf", () => {
	test("a running replay counts processed as enqueued minus pending", () => {
		const p = progressOf(record(), 5);
		expect(p).toMatchObject({
			status: "running",
			total: 9,
			processed: 4,
			pending: 5,
			delivered: null,
			gaveUp: null,
			finishedAt: null,
		});
	});

	test("a done replay reports its stored counts whatever the live count says", () => {
		const p = progressOf(
			record({
				status: "done",
				total: 9,
				delivered: 7,
				gave_up: 2,
				finished_at: new Date("2026-10-18T10:05:00Z"),
			}),
			0,
		);
		expect(p).toMatchObject({
			status: "done",
			total: 9,
			processed: 9,
			pending: 0,
			delivered: 7,
			gaveUp: 2,
			finishedAt: "2026-10-18T10:05:00.000Z",
		});
	});

	test("a failed replay passes its error through", () => {
		const p = progressOf(record({ status: "failed", error: "boom" }), 0);
		expect(p.status).toBe("failed");
		expect(p.error).toBe("boom");
	});

	test("bigint block heights become numbers", () => {
		const p = progressOf(record({ from_block: 100n, to_block: 200n }), 0);
		expect(p.fromBlock).toBe(100);
		expect(p.toBlock).toBe(200);
	});

	test("processed never goes negative when more rows are pending than enqueued", () => {
		expect(progressOf(record({ enqueued_count: 2 }), 5).processed).toBe(0);
	});
});

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("finalizeReplays stale scans", () => {
	const db = HAS_DB ? getDb() : (null as never);
	const accountId = randomUUID();
	const webhookIds: string[] = [];

	afterAll(async () => {
		if (webhookIds.length > 0)
			await db.deleteFrom("webhooks").where("id", "in", webhookIds).execute();
	});

	test("fails a scan older than 30 minutes and stamps finished_at, leaving a fresh scan alone", async () => {
		process.env.SECONDLAYER_SECRETS_KEY ??= "0".repeat(64);
		const { webhook } = await createWebhook(db, {
			accountId,
			name: `reap-${randomUUID().slice(0, 8)}`,
			triggers: [{ type: "stx_transfer" }],
			url: "https://hooks.example.dev/reap",
		});
		webhookIds.push(webhook.id);
		const staleId = randomUUID().replace(/-/g, "").slice(0, 16);
		await db
			.insertInto("webhook_replays")
			.values({
				id: staleId,
				webhook_id: webhook.id,
				from_block: 1,
				to_block: 2,
				status: "scanning",
				started_at: new Date(Date.now() - 31 * 60_000),
			})
			.execute();

		await finalizeReplays(db);

		const row = await db
			.selectFrom("webhook_replays")
			.select(["status", "error", "finished_at"])
			.where("id", "=", staleId)
			.executeTakeFirstOrThrow();
		expect(row.status).toBe("failed");
		expect(row.error).toBe("scan interrupted");
		expect(row.finished_at).not.toBeNull();

		const freshId = randomUUID().replace(/-/g, "").slice(0, 16);
		await db
			.insertInto("webhook_replays")
			.values({
				id: freshId,
				webhook_id: webhook.id,
				from_block: 3,
				to_block: 4,
				status: "scanning",
			})
			.execute();
		await finalizeReplays(db);
		const fresh = await db
			.selectFrom("webhook_replays")
			.select(["status", "finished_at"])
			.where("id", "=", freshId)
			.executeTakeFirstOrThrow();
		expect(fresh.status).toBe("scanning");
		expect(fresh.finished_at).toBeNull();
	});
});

describe("WEBHOOK_REPLAY_MACHINE", () => {
	test("allows the replay lifecycle", () => {
		expect(WEBHOOK_REPLAY_MACHINE.canTransition("scanning", "running")).toBe(
			true,
		);
		expect(WEBHOOK_REPLAY_MACHINE.canTransition("scanning", "failed")).toBe(
			true,
		);
		expect(WEBHOOK_REPLAY_MACHINE.canTransition("running", "done")).toBe(true);
		expect(WEBHOOK_REPLAY_MACHINE.canTransition("done", "running")).toBe(true);
		expect(WEBHOOK_REPLAY_MACHINE.canTransition("failed", "running")).toBe(
			true,
		);
		expect(WEBHOOK_REPLAY_MACHINE.canTransition("done", "scanning")).toBe(true);
	});

	test("rejects skipping the scan or settling a scan as done", () => {
		expect(WEBHOOK_REPLAY_MACHINE.canTransition("scanning", "done")).toBe(
			false,
		);
		expect(WEBHOOK_REPLAY_MACHINE.canTransition("running", "failed")).toBe(
			false,
		);
		expect(() => WEBHOOK_REPLAY_MACHINE.assert("done", "failed")).toThrow(
			"illegal transition done -> failed",
		);
	});
});

describe.skipIf(!HAS_DB)("replay scan transitions", () => {
	const db = HAS_DB ? getDb() : (null as never);
	const accountId = randomUUID();
	const webhookIds: string[] = [];

	afterAll(async () => {
		if (webhookIds.length > 0)
			await db.deleteFrom("webhooks").where("id", "in", webhookIds).execute();
	});

	async function scanningReplay(): Promise<string> {
		process.env.SECONDLAYER_SECRETS_KEY ??= "0".repeat(64);
		const { webhook } = await createWebhook(db, {
			accountId,
			name: `scan-${randomUUID().slice(0, 8)}`,
			triggers: [{ type: "stx_transfer" }],
			url: "https://hooks.example.dev/scan",
		});
		webhookIds.push(webhook.id);
		const id = randomUUID().replace(/-/g, "").slice(0, 16);
		await db
			.insertInto("webhook_replays")
			.values({
				id,
				webhook_id: webhook.id,
				from_block: 1,
				to_block: 2,
				status: "scanning",
			})
			.execute();
		return id;
	}

	test("finishScan moves a scanning replay once, then finalize settles it", async () => {
		const id = await scanningReplay();
		expect(await finishScan(db, id, { scanned: 4, enqueued: 3 })).toBe(true);
		expect(await finishScan(db, id, { scanned: 4, enqueued: 3 })).toBe(false);
		expect(await failScan(db, id, "late")).toBe(false);

		await finalizeReplays(db);
		const row = await db
			.selectFrom("webhook_replays")
			.select(["status", "scanned_count", "enqueued_count", "total", "error"])
			.where("id", "=", id)
			.executeTakeFirstOrThrow();
		expect(row).toMatchObject({
			status: "done",
			scanned_count: 4,
			enqueued_count: 3,
			total: 3,
			error: null,
		});
	});

	test("failScan fails a scanning replay and stamps finished_at", async () => {
		const id = await scanningReplay();
		expect(await failScan(db, id, "boom")).toBe(true);
		const row = await db
			.selectFrom("webhook_replays")
			.select(["status", "error", "finished_at"])
			.where("id", "=", id)
			.executeTakeFirstOrThrow();
		expect(row.status).toBe("failed");
		expect(row.error).toBe("boom");
		expect(row.finished_at).not.toBeNull();
	});
});
