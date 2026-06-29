import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { Block, Database } from "@secondlayer/shared/db";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import type { Kysely } from "kysely";
import type { BlockData } from "./batch-loader.ts";
import type { BlockSource } from "./block-source.ts";
import { replayChainSubscription } from "./replay.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const BLOCK = 980_001;

/**
 * In-memory BlockSource so replay doesn't reach the HTTP Index/Streams plane.
 * sBTC replay only needs the canonical block hash per height — `emitSbtcOutbox`
 * reads the actual `sbtc_events` rows off the source DB itself.
 */
function fakeBlockSource(): BlockSource {
	return {
		getTip: async () => BLOCK,
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

beforeAll(() => {
	db = getDb();
	accountId = randomUUID();
});

afterAll(async () => {
	await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", accountId)
		.execute();
	await db
		.deleteFrom("sbtc_events")
		.where("tx_id", "=", "0xreplay-acc")
		.execute();
});

describe("replayChainSubscription sBTC coverage", () => {
	it("emits sBTC lifecycle webhooks over a replayed block range", async () => {
		const { subscription } = await createSubscription(db, {
			accountId,
			kind: "chain",
			name: `replay-sbtc-${randomUUID().slice(0, 8)}`,
			url: "https://webhook.site/xxx",
			triggers: [{ type: "sbtc_withdrawal_accept" }],
		});

		await db
			.insertInto("sbtc_events")
			.values({
				cursor: `${BLOCK}:0`,
				block_height: BLOCK,
				block_time: new Date("2026-06-01T00:00:00.000Z"),
				tx_id: "0xreplay-acc",
				tx_index: 0,
				event_index: 0,
				topic: "withdrawal-accept",
				request_id: 7777,
				sweep_txid: "0xreplaysweep",
				source_cursor: `${BLOCK}:0`,
			})
			.execute();

		const result = await replayChainSubscription(
			db,
			subscription,
			{
				accountId,
				subscriptionId: subscription.id,
				fromBlock: BLOCK,
				toBlock: BLOCK,
			},
			{ source: fakeBlockSource() },
		);

		expect(result.enqueuedCount).toBe(1);

		const rows = await db
			.selectFrom("subscription_outbox")
			.select(["event_type", "is_replay"])
			.where("subscription_id", "=", subscription.id)
			.execute();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.is_replay).toBe(true);
	});
});
