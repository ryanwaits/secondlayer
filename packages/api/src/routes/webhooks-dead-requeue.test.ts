import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import {
	REORG_ORPHANED_ERROR_PREFIX,
	createWebhook,
} from "@secondlayer/shared/db/queries/webhooks";
import webhooks from "./webhooks.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const webhookIds: string[] = [];
let prevMode: string | undefined;
let prevTestnet: string | undefined;

beforeAll(() => {
	prevMode = process.env.INSTANCE_MODE;
	prevTestnet = process.env.TESTNET_WEBHOOK_STACK;
	process.env.INSTANCE_MODE = "oss";
	Reflect.deleteProperty(process.env, "TESTNET_WEBHOOK_STACK");
});

afterAll(async () => {
	if (prevMode === undefined)
		Reflect.deleteProperty(process.env, "INSTANCE_MODE");
	else process.env.INSTANCE_MODE = prevMode;
	if (prevTestnet !== undefined)
		process.env.TESTNET_WEBHOOK_STACK = prevTestnet;
	if (!HAS_DB || webhookIds.length === 0) return;
	await db.deleteFrom("webhooks").where("id", "in", webhookIds).execute();
});

async function makeWebhookWithDeadRows() {
	const { webhook } = await createWebhook(db, {
		accountId: "",
		name: `dead-${randomUUID().slice(0, 8)}`,
		triggers: [{ type: "stx_transfer" }],
		url: "https://example.com/hook",
	});
	webhookIds.push(webhook.id);
	const insert = (txId: string, lastError: string) =>
		db
			.insertInto("webhook_outbox")
			.values({
				webhook_id: webhook.id,
				block_height: 100,
				tx_id: txId,
				row_pk: { blockHeight: 100, txId, rowIndex: 0 },
				event_type: "chain.stx_transfer.apply",
				payload: {},
				dedup_key: `dead-${randomUUID().slice(0, 12)}`,
				status: "dead",
				dead_reason: lastError.startsWith(REORG_ORPHANED_ERROR_PREFIX)
					? "orphaned"
					: "exhausted",
				failed_at: new Date(),
				last_error: lastError,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
	const failed = await insert("0xfailed", "HTTP 500");
	const orphaned = await insert(
		"0xorphaned",
		`${REORG_ORPHANED_ERROR_PREFIX}100`,
	);
	return { webhook, failedId: failed.id, orphanedId: orphaned.id };
}

async function statusOf(id: string): Promise<string> {
	const row = await db
		.selectFrom("webhook_outbox")
		.select("status")
		.where("id", "=", id)
		.executeTakeFirstOrThrow();
	return row.status;
}

describe.skipIf(!HAS_DB)("dead-letter requeue", () => {
	test("an orphaned dead row stays dead on bulk requeue", async () => {
		const { webhook, failedId, orphanedId } = await makeWebhookWithDeadRows();

		const res = await webhooks.request(`/${webhook.id}/dead/requeue`, {
			method: "POST",
		});

		expect(res.status).toBe(200);
		expect(((await res.json()) as { requeued: number }).requeued).toBe(1);
		expect(await statusOf(failedId)).toBe("pending");
		expect(await statusOf(orphanedId)).toBe("dead");
	});

	test("bulk requeue by replay leaves a replay that is still scanning in its state", async () => {
		const { webhook, failedId } = await makeWebhookWithDeadRows();
		const replayId = randomUUID().replace(/-/g, "").slice(0, 16);
		await db
			.insertInto("webhook_replays")
			.values({
				id: replayId,
				webhook_id: webhook.id,
				from_block: 1,
				to_block: 2,
				status: "scanning",
			})
			.execute();
		await db
			.updateTable("webhook_outbox")
			.set({ replay_id: replayId })
			.where("id", "=", failedId)
			.execute();

		const res = await webhooks.request(`/${webhook.id}/dead/requeue`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ replayId }),
		});

		expect(res.status).toBe(200);
		expect(((await res.json()) as { requeued: number }).requeued).toBe(1);
		const replay = await db
			.selectFrom("webhook_replays")
			.select("status")
			.where("id", "=", replayId)
			.executeTakeFirstOrThrow();
		expect(replay.status).toBe("scanning");
	});

	test("an orphaned dead row cannot be requeued one at a time", async () => {
		const { webhook, orphanedId } = await makeWebhookWithDeadRows();

		const res = await webhooks.request(
			`/${webhook.id}/dead/${orphanedId}/requeue`,
			{ method: "POST" },
		);

		expect(res.status).toBe(404);
		expect(await statusOf(orphanedId)).toBe("dead");
	});

	test("the dead preview lists requeueable rows and counts orphaned ones apart", async () => {
		const { webhook, failedId } = await makeWebhookWithDeadRows();

		const res = await webhooks.request(`/${webhook.id}/dead`);

		const body = (await res.json()) as {
			data: { id: string }[];
			orphanedByReorg: number;
		};
		expect(body.data.map((r) => r.id)).toEqual([failedId]);
		expect(body.orphanedByReorg).toBe(1);
	});
});
