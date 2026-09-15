import { beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import { parseIndexEventsQuery, readIndexEvents } from "./events.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_301;
const TIP: IndexTip = {
	block_height: H,
	finalized_height: H - 6,
	lag_seconds: 1,
};

describe("Index vm_events query parse", () => {
	function params(query: string) {
		return new URL(`http://localhost/v1/index/events${query}`).searchParams;
	}

	test("nested_contract_call is an Index event_type", () => {
		const parsed = parseIndexEventsQuery(
			params("?event_type=nested_contract_call"),
			TIP,
		);
		expect(parsed.eventType).toBe("nested_contract_call");
	});

	test("contract_call is still not an Index event_type", () => {
		expect(() =>
			parseIndexEventsQuery(params("?event_type=contract_call"), TIP),
		).toThrow("unknown event_type");
	});

	test("map filter is accepted for map_set", () => {
		const parsed = parseIndexEventsQuery(
			params("?event_type=map_set&map=store"),
			TIP,
		);
		expect(parsed.filters.map).toBe("store");
	});
});

describe.skipIf(!HAS_DB)("Index vm_events read", () => {
	const db = HAS_DB ? getSourceDb() : null;
	const txId = "0xvm-index-tx";

	beforeEach(async () => {
		if (!db) return;
		await db.deleteFrom("vm_events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
	});

	async function seed() {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values({
				height: H,
				hash: "0xvm-index",
				parent_hash: "0xparent",
				burn_block_height: 1,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values({
				tx_id: txId,
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
					tx_id: txId,
					block_height: H,
					vm_event_index: 0,
					type: "nested_contract_call",
					data: {
						contract_identifier: "SP.store",
						sender: "SP1",
						caller: "SP.caller",
						function_name: "set-value",
						function_args: ["0x0d"],
						raw_result: "0x0703",
					},
				},
				{
					tx_id: txId,
					block_height: H,
					vm_event_index: 1,
					type: "map_set",
					data: {
						contract_identifier: "SP.store",
						map_name: "store",
						raw_key: "0x0a",
						raw_value: "0x0b",
					},
				},
			])
			.execute();
	}

	test("reads remapped nested call + map_set on vm_event_index cursor", async () => {
		await seed();
		const nested = await readIndexEvents({
			eventType: "nested_contract_call",
			fromHeight: H,
			toHeight: H,
			limit: 25,
			db: db ?? undefined,
		});
		expect(nested.events).toHaveLength(1);
		expect(nested.events[0]?.event_type).toBe("nested_contract_call");
		expect(nested.events[0]?.event_index).toBe(0);
		expect(nested.events[0]?.cursor).toBe(`${H}:0`);
		expect(nested.events[0]?.function_name).toBe("set-value");

		const maps = await readIndexEvents({
			eventType: "map_set",
			fromHeight: H,
			toHeight: H,
			limit: 25,
			db: db ?? undefined,
		});
		expect(maps.events).toHaveLength(1);
		expect(maps.events[0]?.event_index).toBe(1);
		expect(maps.events[0]?.map).toBe("store");
	});

	test("empty vm_events table yields empty Index pages", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values({
				height: H,
				hash: "0xvm-empty",
				parent_hash: "0xparent",
				burn_block_height: 1,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
		const nested = await readIndexEvents({
			eventType: "nested_contract_call",
			fromHeight: H,
			toHeight: H,
			limit: 25,
			db,
		});
		expect(nested.events).toHaveLength(0);
		expect(nested.next_cursor).toBeNull();
	});
});
