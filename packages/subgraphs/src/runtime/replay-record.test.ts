import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { Block, Database } from "@secondlayer/shared/db";
import {
	ReplayInProgressError,
	beginReplay,
	readReplay,
} from "@secondlayer/shared/db/queries/webhook-replays";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import type { Kysely } from "kysely";
import type { BlockData } from "./batch-loader.ts";
import type { BlockSource } from "./block-source.ts";
import { replayWebhook } from "./replay.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const FIRST = 981_001;
const LAST = 981_003;
const TX = "0xreplay-record";

function fakeBlockSource(): BlockSource {
	return {
		getTip: async () => LAST,
		loadBlockRange: async (from: number, to: number) => {
			const map = new Map<number, BlockData>();
			for (let h = from; h <= to; h++) {
				map.set(h, {
					block: { height: h, hash: `0xblock-${h}` } as unknown as Block,
					txs: [],
					events: [],
				});
			}
			return map;
		},
	};
}

let db: Kysely<Database>;
let accountId: string;
// By id, not account: OSS mode stores every webhook with account_id "".
const webhookIds: string[] = [];

async function newWebhook() {
	const { webhook } = await createWebhook(db, {
		accountId,
		name: `replay-record-${randomUUID().slice(0, 8)}`,
		url: "https://webhook.site/xxx",
		triggers: [{ type: "sbtc_withdrawal_accept" }],
	});
	webhookIds.push(webhook.id);
	return webhook;
}

function replay(webhookId: string, opts?: { source?: BlockSource }) {
	return replayWebhook(
		{ accountId, webhookId, fromBlock: FIRST, toBlock: LAST },
		{ source: fakeBlockSource(), ...opts },
	);
}

beforeAll(async () => {
	db = getDb();
	accountId = randomUUID();
	await db
		.insertInto("sbtc_events")
		.values(
			[FIRST, FIRST + 1, FIRST + 2].map((height, i) => ({
				cursor: `${height}:0`,
				block_height: height,
				block_time: new Date("2026-06-01T00:00:00.000Z"),
				tx_id: TX,
				tx_index: 0,
				event_index: i,
				topic: "withdrawal-accept",
				request_id: 9000 + i,
				sweep_txid: "0xreplayrecordsweep",
				source_cursor: `${height}:0`,
			})),
		)
		.execute();
});

afterAll(async () => {
	if (webhookIds.length > 0)
		await db.deleteFrom("webhooks").where("id", "in", webhookIds).execute();
	await db.deleteFrom("sbtc_events").where("tx_id", "=", TX).execute();
});

describe("replay record", () => {
	it("records a running replay and tags every outbox row with its replay id", async () => {
		const webhook = await newWebhook();
		const result = await replay(webhook.id);
		expect(result.enqueuedCount).toBe(3);

		const record = await db
			.selectFrom("webhook_replays")
			.selectAll()
			.where("id", "=", result.replayId)
			.executeTakeFirstOrThrow();
		expect(record.status).toBe("running");
		expect(record.enqueued_count).toBe(3);
		expect(record.scanned_count).toBe(3);

		const rows = await db
			.selectFrom("webhook_outbox")
			.select("replay_id")
			.where("webhook_id", "=", webhook.id)
			.execute();
		expect(rows).toHaveLength(3);
		expect(rows.every((r) => r.replay_id === result.replayId)).toBe(true);
	});

	it("refuses a second replay while one is scanning", async () => {
		const webhook = await newWebhook();
		await beginReplay(db, {
			id: "aaaaaaaaaaaaaaaa",
			webhookId: webhook.id,
			fromBlock: 1,
			toBlock: 2,
		});
		await expect(
			beginReplay(db, {
				id: "bbbbbbbbbbbbbbbb",
				webhookId: webhook.id,
				fromBlock: 3,
				toBlock: 4,
			}),
		).rejects.toBeInstanceOf(ReplayInProgressError);
		// The same range while it is still scanning is also a concurrent scan.
		await expect(
			beginReplay(db, {
				id: "aaaaaaaaaaaaaaaa",
				webhookId: webhook.id,
				fromBlock: 1,
				toBlock: 2,
			}),
		).rejects.toBeInstanceOf(ReplayInProgressError);
	});

	it("does not let a scan that died 31 minutes ago block new replays", async () => {
		const webhook = await newWebhook();
		await db
			.insertInto("webhook_replays")
			.values({
				id: "cccccccccccccccc",
				webhook_id: webhook.id,
				from_block: 1,
				to_block: 2,
				status: "scanning",
				started_at: new Date(Date.now() - 31 * 60_000),
			})
			.execute();
		await beginReplay(db, {
			id: "dddddddddddddddd",
			webhookId: webhook.id,
			fromBlock: 3,
			toBlock: 4,
		});
		const stale = await db
			.selectFrom("webhook_replays")
			.select(["status", "error"])
			.where("id", "=", "cccccccccccccccc")
			.executeTakeFirstOrThrow();
		expect(stale).toEqual({ status: "failed", error: "scan interrupted" });
	});

	it("leaves a failed record with the error when the scan throws", async () => {
		const webhook = await newWebhook();
		const broken: BlockSource = {
			getTip: async () => LAST,
			loadBlockRange: async () => {
				throw new Error("index unreachable");
			},
		};
		await expect(replay(webhook.id, { source: broken })).rejects.toThrow(
			"index unreachable",
		);
		const record = await db
			.selectFrom("webhook_replays")
			.select(["status", "error"])
			.where("webhook_id", "=", webhook.id)
			.executeTakeFirstOrThrow();
		expect(record.status).toBe("failed");
		expect(record.error).toContain("index unreachable");
	});

	it("finalizes to done with delivered and gave-up counts once nothing is pending", async () => {
		const webhook = await newWebhook();
		const { replayId } = await replay(webhook.id);

		const running = await readReplay(db, webhook.id, replayId);
		expect(running).toMatchObject({
			status: "running",
			total: 3,
			processed: 0,
			pending: 3,
			delivered: null,
			gaveUp: null,
		});

		const rows = await db
			.selectFrom("webhook_outbox")
			.select("id")
			.where("webhook_id", "=", webhook.id)
			.execute();
		await db
			.updateTable("webhook_outbox")
			.set({ status: "delivered", delivered_at: new Date() })
			.where(
				"id",
				"in",
				rows.slice(1).map((r) => r.id),
			)
			.execute();
		await db
			.updateTable("webhook_outbox")
			.set({ status: "dead", failed_at: new Date() })
			.where("id", "=", rows[0]?.id as string)
			.execute();

		const done = await readReplay(db, webhook.id, replayId);
		expect(done).toMatchObject({
			status: "done",
			total: 3,
			processed: 3,
			pending: 0,
			delivered: 2,
			gaveUp: 1,
		});
		const stored = await db
			.selectFrom("webhook_replays")
			.select(["status", "total", "delivered", "gave_up"])
			.where("id", "=", replayId)
			.executeTakeFirstOrThrow();
		expect(stored).toEqual({
			status: "done",
			total: 3,
			delivered: 2,
			gave_up: 1,
		});
	});

	it("reuses the record and adds nothing when the same range runs again", async () => {
		const webhook = await newWebhook();
		const first = await replay(webhook.id);
		const second = await replay(webhook.id);
		expect(second.replayId).toBe(first.replayId);
		expect(second.enqueuedCount).toBe(0);

		const records = await db
			.selectFrom("webhook_replays")
			.select(["id", "enqueued_count"])
			.where("webhook_id", "=", webhook.id)
			.execute();
		expect(records).toEqual([{ id: first.replayId, enqueued_count: 3 }]);
	});
});
