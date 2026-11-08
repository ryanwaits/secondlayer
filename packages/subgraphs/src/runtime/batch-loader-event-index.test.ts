import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database, Event } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { loadBlockRange, numberBlockEvents } from "./batch-loader.ts";

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

const asKey = (e: { tx_id: string; event_index: number }) =>
	`${e.tx_id}#${e.event_index}`;

describe("the Postgres block source numbers events by position in the block", () => {
	it("restarts-per-transaction history gets block-wide indexes and ids", async () => {
		const data = (await loadBlockRange(db, PER_TX, PER_TX)).get(PER_TX);
		const ordered = [...(data?.events ?? [])].sort(
			(a, b) => a.event_index - b.event_index,
		);
		expect(ordered.map(asKey)).toEqual([
			"0xei-tx4#0",
			"0xei-tx5#1",
			"0xei-tx5#2",
		]);
	});

	it("a block already numbered across the block is unchanged", async () => {
		const data = (await loadBlockRange(db, PER_BLOCK, PER_BLOCK)).get(
			PER_BLOCK,
		);
		const ordered = [...(data?.events ?? [])].sort(
			(a, b) => a.event_index - b.event_index,
		);
		expect(ordered.map(asKey)).toEqual([
			"0xei-tx0#0",
			"0xei-tx1#1",
			"0xei-tx1#2",
		]);
	});
});

describe("events outside the Streams numbering", () => {
	const ev = (tx_id: string, event_index: number, type: string) =>
		({ tx_id, event_index, type }) as Event;

	it("keep their raw index and do not shift the numbered ones", () => {
		const { events, skipped } = numberBlockEvents(
			[
				ev("0xa", 0, "contract_event"),
				ev("0xa", 1, "unknown_event"),
				ev("0xmissing", 0, "contract_event"),
				ev("0xa", 2, "stx_transfer_event"),
			],
			[{ tx_id: "0xa", tx_index: 3 }],
		);
		expect(skipped).toBe(2);
		expect(
			events.map((e) => `${e.tx_id}:${e.type}:${e.event_index}`).sort(),
		).toEqual([
			"0xa:contract_event:0",
			"0xa:stx_transfer_event:1",
			"0xa:unknown_event:1",
			"0xmissing:contract_event:0",
		]);
	});
});
