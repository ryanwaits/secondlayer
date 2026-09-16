import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import { readCanonicalVmEvents } from "./vm-streams-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_401;
const TX = "0xvm-streams-tx";

describe.skipIf(!HAS_DB)("Streams clock=vm reader", () => {
	const db = HAS_DB ? getSourceDb() : null;

	async function cleanup(): Promise<void> {
		if (!db) return;
		await db.deleteFrom("vm_events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
	}

	// Leave no canonical block behind: other suites assert the DB tip.
	afterAll(cleanup);

	beforeEach(async () => {
		if (!db) return;
		await cleanup();
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
		expect(all.events.map((e) => [e.event_type, e.event_index])).toEqual([
			["nested_contract_call", 0],
			["map_set", 1],
		]);
		expect(all.next_cursor).toBe(`${H}:1`);

		const noMaps = await readCanonicalVmEvents({
			fromHeight: H,
			toHeight: H,
			limit: 10,
			notTypes: ["map_set"],
			db,
		});
		expect(noMaps.events.map((e) => e.event_type)).toEqual([
			"nested_contract_call",
		]);
	});

	test("inverted range (cursor past toHeight) returns null, not a rewind sentinel", async () => {
		if (!db) throw new Error("missing db");
		const pastCursor = await readCanonicalVmEvents({
			after: { block_height: 100, event_index: 7 },
			toHeight: 90,
			limit: 10,
			db,
		});
		expect(pastCursor.events).toEqual([]);
		expect(pastCursor.next_cursor).toBeNull();

		const invertedFrom = await readCanonicalVmEvents({
			fromHeight: 100,
			toHeight: 90,
			limit: 10,
			db,
		});
		expect(invertedFrom.events).toEqual([]);
		expect(invertedFrom.next_cursor).toBeNull();
	});

	test("filtered-empty range returns the bounded empty sentinel, not null", async () => {
		if (!db) throw new Error("missing db");
		const page = await readCanonicalVmEvents({
			fromHeight: H,
			toHeight: H,
			limit: 10,
			contractId: "SP.missing",
			db,
		});
		expect(page.events).toEqual([]);
		expect(page.next_cursor).toBe(`${H}:2147483647`);
	});
});
