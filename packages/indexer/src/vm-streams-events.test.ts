import { beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import { readCanonicalVmEvents } from "./vm-streams-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_401;
const TX = "0xvm-streams-tx";

describe.skipIf(!HAS_DB)("Streams clock=vm reader", () => {
	const db = HAS_DB ? getSourceDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db.deleteFrom("vm_events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		await db
			.insertInto("blocks")
			.values({
				height: H,
				hash: "0xvm-streams",
				parent_hash: "0xparent",
				burn_block_height: 1,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values({
				tx_id: TX,
				block_height: H,
				tx_index: 0,
				type: "contract_call",
				sender: "SP1",
				status: "success",
				raw_tx: "0x00",
			})
			.execute();
		await db
			.insertInto("vm_events")
			.values([
				{
					tx_id: TX,
					block_height: H,
					vm_event_index: 0,
					type: "nested_contract_call",
					data: { contract_identifier: "SP.store", caller: "SP.c" },
				},
				{
					tx_id: TX,
					block_height: H,
					vm_event_index: 1,
					type: "map_set",
					data: { contract_identifier: "SP.store", map_name: "store" },
				},
			])
			.execute();
	});

	test("not_types excludes a vm type; cursor is vm_event_index", async () => {
		if (!db) throw new Error("missing db");
		const all = await readCanonicalVmEvents({
			fromHeight: H,
			toHeight: H,
			limit: 10,
			db,
		});
		// StreamsEvent.event_type is still the classic union (the vm reader casts);
		// compare as strings until the row vocab is widened.
		expect(
			all.events.map((e) => [String(e.event_type), e.event_index]),
		).toEqual([
			["nested_contract_call", 0],
			["map_set", 1],
		]);
		expect(all.next_cursor).toBe(`${H}:1`);

		const noMaps = await readCanonicalVmEvents({
			fromHeight: H,
			toHeight: H,
			limit: 10,
			notTypes: ["map_set"] as never,
			db,
		});
		expect(noMaps.events.map((e) => String(e.event_type))).toEqual([
			"nested_contract_call",
		]);
	});
});
