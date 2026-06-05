import { beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { STREAMS_DB_EVENT_TYPES } from "./streams-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990050;

// Events at the orphaned tip, including a `contract_event` print — the current
// post-rename label that the old forked list in reorg.ts omitted. Order matters:
// event_index is assigned by position so the firehose count maps to a cursor.
const SEED_EVENTS = [
	{ event_index: 0, type: "stx_transfer_event" },
	{ event_index: 1, type: "contract_event" },
	{ event_index: 2, type: "nft_mint_event" },
] as const;

async function seedOrphanedBlock(db: NonNullable<ReturnType<typeof getDb>>) {
	await db
		.insertInto("blocks")
		.values({
			height: H,
			hash: "0xreorgA",
			parent_hash: "0xparent",
			burn_block_height: 1,
			burn_block_hash: null,
			timestamp: 1_700_000_000,
			canonical: true,
		})
		.execute();
	await db
		.insertInto("transactions")
		.values({
			tx_id: "0xreorgtx",
			block_height: H,
			tx_index: 0,
			type: "contract_call",
			sender: "SP1",
			status: "success",
			contract_id: "SP1.c",
			function_name: "f",
			raw_tx: "0x00",
		})
		.execute();
	await db
		.insertInto("events")
		.values(
			SEED_EVENTS.map((e) => ({
				tx_id: "0xreorgtx",
				block_height: H,
				event_index: e.event_index,
				type: e.type,
				data: {},
			})),
		)
		.execute();
}

describe.skipIf(!HAS_DB)("handleReorg orphaned_to cursor", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db
			.deleteFrom("decoded_events")
			.where("block_height", "=", H)
			.execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		await db
			.deleteFrom("chain_reorgs")
			.where("fork_point_height", "=", H)
			.execute();
	});

	test("seed inserts the orphaned block's streams-typed events", async () => {
		if (!db) throw new Error("missing db");
		await seedOrphanedBlock(db);

		const seeded = await db
			.selectFrom("events")
			.select(({ fn }) => fn.countAll<string>().as("count"))
			.where("block_height", "=", H)
			.where("type", "in", [...STREAMS_DB_EVENT_TYPES])
			.executeTakeFirstOrThrow();

		expect(Number(seeded.count)).toBe(SEED_EVENTS.length);
	});
});
