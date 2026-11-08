import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { STREAMS_DB_EVENT_TYPES } from "@secondlayer/shared";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { loadBlockRange } from "./batch-loader.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

/** Per-transaction raw numbering (imported history). */
const PER_TX = 5_100_000;
/** Raw numbering already counts across the block. */
const PER_BLOCK = 5_100_001;
const HEIGHTS = [PER_TX, PER_BLOCK];
let db: Kysely<Database>;

async function clean() {
	for (const h of HEIGHTS) {
		await db.deleteFrom("events").where("block_height", "=", h).execute();
		await db.deleteFrom("transactions").where("block_height", "=", h).execute();
		await db.deleteFrom("blocks").where("height", "=", h).execute();
	}
}

async function insertBlock(height: number, txs: Array<[string, number]>) {
	await db
		.insertInto("blocks")
		.values({
			height,
			hash: `0xeventindex${height}`,
			parent_hash: "0xparent",
			burn_block_height: height,
			burn_block_hash: null,
			timestamp: 1_700_000_000,
			canonical: true,
		})
		.execute();
	for (const [txId, txIndex] of txs) {
		await sql`
			INSERT INTO transactions (tx_id, block_height, tx_index, type, sender, status, raw_tx)
			VALUES (${txId}, ${height}, ${txIndex}, 'token_transfer', 'SP1', 'success', '0x00')
		`.execute(db);
	}
}

async function insertEvent(height: number, txId: string, rawIndex: number) {
	await db
		.insertInto("events")
		.values({
			tx_id: txId,
			block_height: height,
			event_index: rawIndex,
			type: "contract_event",
			data: {
				contract_identifier: "SP1.c",
				topic: `${txId}:${rawIndex}`,
				value: { repr: "u1", hex: "0x0100000000000000000000000000000001" },
			},
		})
		.execute();
}

beforeAll(async () => {
	db = getDb();
	await clean();

	await insertBlock(PER_TX, [
		["0xei-tx4", 4],
		["0xei-tx5", 5],
	]);
	// Inserted out of order: numbering must not depend on row order.
	await insertEvent(PER_TX, "0xei-tx5", 1);
	await insertEvent(PER_TX, "0xei-tx4", 0);
	await insertEvent(PER_TX, "0xei-tx5", 0);

	await insertBlock(PER_BLOCK, [
		["0xei-tx0", 0],
		["0xei-tx1", 1],
	]);
	await insertEvent(PER_BLOCK, "0xei-tx0", 0);
	await insertEvent(PER_BLOCK, "0xei-tx1", 1);
	await insertEvent(PER_BLOCK, "0xei-tx1", 2);
});

afterAll(clean);

describe("the Postgres block source agrees with Streams", () => {
	it("matches the event_index the Streams query returns for each event", async () => {
		for (const height of HEIGHTS) {
			const ours = (await loadBlockRange(db, height, height)).get(height);
			// Copy of the ordinal in `streamOrdinalCtes`
			// (packages/indexer/src/streams-events.ts): subgraphs cannot import the
			// indexer package, so the SQL is reproduced here.
			const { rows } = await sql<{ topic: string; stream_event_index: string }>`
				SELECT e2.data->>'topic' AS topic,
					ROW_NUMBER() OVER (
						PARTITION BY e2.block_height
						ORDER BY t2.tx_index ASC, e2.event_index ASC
					) - 1 AS stream_event_index
				FROM events e2
				INNER JOIN transactions t2 ON t2.tx_id = e2.tx_id
				WHERE e2.type IN (${sql.join(STREAMS_DB_EVENT_TYPES.map((t) => sql`${t}`))})
					AND e2.block_height = ${height}
			`.execute(db);
			const streamsByTopic = new Map(
				rows.map((r) => [r.topic, Number(r.stream_event_index)]),
			);
			expect(streamsByTopic.size).toBe(3);
			for (const e of ours?.events ?? []) {
				const topic = (e.data as { topic: string }).topic;
				expect(e.event_index).toBe(streamsByTopic.get(topic) as number);
			}
		}
	});
});
