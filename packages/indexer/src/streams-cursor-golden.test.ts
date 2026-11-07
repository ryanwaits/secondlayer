import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { STREAMS_CURSOR_VERSION } from "@secondlayer/shared";
import { getDb, sql } from "@secondlayer/shared/db";
import { readCanonicalStreamsEvents } from "./streams-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 991_101;

/**
 * Golden cursors for one fixture block. A saved cursor is
 * `height:ordinal`, the ordinal counting every Streams-typed event of the
 * block in `(tx_index, event_index)` order. These values are the public
 * contract: if this test needs new numbers, the event type list changed and
 * `STREAMS_CURSOR_VERSION` must be bumped with it.
 */
const GOLDEN_CURSOR_VERSION = 1;
const GOLDEN: Array<{ cursor: string; eventType: string }> = [
	{ cursor: `${H}:0`, eventType: "stx_transfer" },
	{ cursor: `${H}:1`, eventType: "ft_mint" },
	{ cursor: `${H}:2`, eventType: "print" },
	{ cursor: `${H}:3`, eventType: "nft_burn" },
	{ cursor: `${H}:4`, eventType: "print" },
];

describe.skipIf(!HAS_DB)("streams cursor golden fixture", () => {
	const db = HAS_DB ? getDb() : null;

	async function clean() {
		if (!db) return;
		await sql`DELETE FROM events WHERE block_height = ${H}`.execute(db);
		await sql`DELETE FROM transactions WHERE block_height = ${H}`.execute(db);
		await sql`DELETE FROM blocks WHERE height = ${H}`.execute(db);
	}
	beforeEach(clean);
	afterAll(clean);

	test("cursors for a mixed-type block match the pinned ordinals", async () => {
		if (!db) throw new Error("missing db");
		expect(STREAMS_CURSOR_VERSION).toBe(GOLDEN_CURSOR_VERSION);

		await db
			.insertInto("blocks")
			.values({
				height: H,
				hash: "0xgolden",
				parent_hash: "0xparent",
				burn_block_height: 1,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values([
				{
					tx_id: "tx-golden-a",
					block_height: H,
					tx_index: 0,
					type: "contract_call",
					sender: "SP1",
					status: "success",
					contract_id: "SP1.c",
					raw_tx: "0x00",
				},
				{
					tx_id: "tx-golden-b",
					block_height: H,
					tx_index: 1,
					type: "contract_call",
					sender: "SP1",
					status: "success",
					contract_id: "SP1.c",
					raw_tx: "0x01",
				},
			])
			.execute();
		await db
			.insertInto("events")
			.values([
				{
					tx_id: "tx-golden-a",
					block_height: H,
					event_index: 0,
					type: "stx_transfer_event",
					data: { sender: "SP1", recipient: "SP2", amount: "1" },
				},
				// Not a Streams type: takes no ordinal and shifts none.
				{
					tx_id: "tx-golden-a",
					block_height: H,
					event_index: 1,
					type: "vrf_event",
					data: {},
				},
				{
					tx_id: "tx-golden-a",
					block_height: H,
					event_index: 2,
					type: "ft_mint_event",
					data: {
						asset_identifier: "SP1.tok::tok",
						recipient: "SP2",
						amount: "1",
					},
				},
				{
					tx_id: "tx-golden-a",
					block_height: H,
					event_index: 3,
					type: "smart_contract_event",
					data: {
						contract_identifier: "SP1.c",
						topic: "print",
						value: { repr: "u1" },
					},
				},
				{
					tx_id: "tx-golden-b",
					block_height: H,
					event_index: 4,
					type: "nft_burn_event",
					data: {
						asset_identifier: "SP1.nft::nft",
						sender: "SP1",
						value: { repr: "u1" },
					},
				},
				{
					tx_id: "tx-golden-b",
					block_height: H,
					event_index: 5,
					type: "contract_event",
					data: {
						contract_identifier: "SP1.c",
						topic: "print",
						value: { repr: "u2" },
					},
				},
			])
			.execute();

		const page = await readCanonicalStreamsEvents({
			fromHeight: H,
			toHeight: H,
			limit: 50,
			db,
		});

		expect(
			page.events.map((e) => ({ cursor: e.cursor, eventType: e.event_type })),
		).toEqual(GOLDEN);
	});
});
