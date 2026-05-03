import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { readCanonicalStreamsEvents } from "./streams-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("readCanonicalStreamsEvents", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	test("ordering invariant holds across multi-block, multi-tx pages", async () => {
		if (!db) throw new Error("missing db");

		await db
			.insertInto("blocks")
			.values([
				{
					height: 1,
					hash: "0x01",
					parent_hash: "0x00",
					burn_block_height: 101,
					timestamp: 1000,
					canonical: true,
				},
				{
					height: 2,
					hash: "0x02",
					parent_hash: "0x01",
					burn_block_height: 102,
					timestamp: 1001,
					canonical: true,
				},
			])
			.execute();
		await db
			.insertInto("transactions")
			.values([
				{
					tx_id: "tx-late",
					block_height: 1,
					tx_index: 2,
					type: "contract_call",
					sender: "SP1",
					status: "success",
					contract_id: "SP1.late",
					raw_tx: "0x01",
				},
				{
					tx_id: "tx-coinbase",
					block_height: 1,
					tx_index: 0,
					type: "coinbase",
					sender: "SP0",
					status: "success",
					contract_id: null,
					raw_tx: "0x00",
				},
				{
					tx_id: "tx-next",
					block_height: 2,
					tx_index: 0,
					type: "token_transfer",
					sender: "SP2",
					status: "success",
					contract_id: null,
					raw_tx: "0x02",
				},
			])
			.execute();
		await db
			.insertInto("events")
			.values([
				{
					tx_id: "tx-late",
					block_height: 1,
					event_index: 1,
					type: "smart_contract_event",
					data: {
						contract_identifier: "SP1.late",
						topic: "print",
						value: { repr: "u1" },
					},
				},
				{
					tx_id: "tx-late",
					block_height: 1,
					event_index: 0,
					type: "ft_transfer_event",
					data: {
						asset_identifier: "SP1.token::token",
						sender: "SP1",
						recipient: "SP2",
						amount: "1",
					},
				},
				{
					tx_id: "tx-coinbase",
					block_height: 1,
					event_index: 0,
					type: "stx_mint_event",
					data: { recipient: "SP0", amount: "10" },
				},
				{
					tx_id: "tx-next",
					block_height: 2,
					event_index: 0,
					type: "stx_transfer_event",
					data: { sender: "SP2", recipient: "SP3", amount: "2" },
				},
			])
			.execute();

		const page = await readCanonicalStreamsEvents({
			fromHeight: 1,
			toHeight: 2,
			limit: 10,
			db,
		});

		expect(page.next_cursor).toBe("2:0");
		expect(page.events.map((event) => event.cursor)).toEqual([
			"1:0",
			"1:1",
			"1:2",
			"2:0",
		]);
		expect(page.events.map((event) => event.tx_index)).toEqual([0, 2, 2, 0]);
		expect(page.events.map((event) => event.event_type)).toEqual([
			"stx_mint",
			"ft_transfer",
			"print",
			"stx_transfer",
		]);
		expect(page.events[2]?.payload).toEqual({
			contract_id: "SP1.late",
			topic: "print",
			value: { repr: "u1" },
		});

		const filteredPage = await readCanonicalStreamsEvents({
			fromHeight: 1,
			toHeight: 2,
			types: ["ft_transfer"],
			limit: 10,
			db,
		});

		expect(filteredPage.events.map((event) => event.cursor)).toEqual(["1:1"]);
		expect(filteredPage.events.map((event) => event.event_type)).toEqual([
			"ft_transfer",
		]);
	});

	test("types filter returns matching events without scanning excluded pages", async () => {
		if (!db) throw new Error("missing db");

		await db
			.insertInto("blocks")
			.values([
				{
					height: 1,
					hash: "0x01",
					parent_hash: "0x00",
					burn_block_height: 101,
					timestamp: 1000,
					canonical: true,
				},
				{
					height: 2,
					hash: "0x02",
					parent_hash: "0x01",
					burn_block_height: 102,
					timestamp: 1001,
					canonical: true,
				},
			])
			.execute();
		await db
			.insertInto("transactions")
			.values([
				{
					tx_id: "tx-filter-1",
					block_height: 1,
					tx_index: 0,
					type: "token_transfer",
					sender: "SP1",
					status: "success",
					contract_id: null,
					raw_tx: "0x01",
				},
				{
					tx_id: "tx-filter-2",
					block_height: 1,
					tx_index: 1,
					type: "token_transfer",
					sender: "SP2",
					status: "success",
					contract_id: null,
					raw_tx: "0x02",
				},
				{
					tx_id: "tx-filter-3",
					block_height: 2,
					tx_index: 0,
					type: "contract_call",
					sender: "SP3",
					status: "success",
					contract_id: "SP3.print",
					raw_tx: "0x03",
				},
			])
			.execute();
		await db
			.insertInto("events")
			.values([
				{
					tx_id: "tx-filter-1",
					block_height: 1,
					event_index: 0,
					type: "stx_transfer_event",
					data: { sender: "SP1", recipient: "SP2", amount: "1" },
				},
				{
					tx_id: "tx-filter-2",
					block_height: 1,
					event_index: 0,
					type: "stx_mint_event",
					data: { recipient: "SP2", amount: "2" },
				},
				{
					tx_id: "tx-filter-3",
					block_height: 2,
					event_index: 0,
					type: "smart_contract_event",
					data: {
						contract_identifier: "SP3.print",
						topic: "print",
						value: { repr: "u3" },
					},
				},
			])
			.execute();

		const firstPage = await readCanonicalStreamsEvents({
			fromHeight: 1,
			toHeight: 2,
			types: ["print"],
			limit: 2,
			db,
		});
		expect(firstPage.events.map((event) => event.event_type)).toEqual([
			"print",
		]);
		expect(firstPage.events.map((event) => event.cursor)).toEqual(["2:0"]);
		expect(firstPage.next_cursor).toBe("2:0");

		const secondPage = await readCanonicalStreamsEvents({
			after: { block_height: 2, event_index: 0 },
			toHeight: 2,
			types: ["print"],
			limit: 2,
			db,
		});
		expect(secondPage.events).toEqual([]);
		expect(secondPage.next_cursor).toBeNull();
	});

	test("types filter returns null cursor when no selected types match", async () => {
		if (!db) throw new Error("missing db");

		await db
			.insertInto("blocks")
			.values({
				height: 1,
				hash: "0x01",
				parent_hash: "0x00",
				burn_block_height: 101,
				timestamp: 1000,
				canonical: true,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values([
				{
					tx_id: "tx-tail-1",
					block_height: 1,
					tx_index: 0,
					type: "token_transfer",
					sender: "SP1",
					status: "success",
					contract_id: null,
					raw_tx: "0x01",
				},
				{
					tx_id: "tx-tail-2",
					block_height: 1,
					tx_index: 1,
					type: "token_transfer",
					sender: "SP2",
					status: "success",
					contract_id: null,
					raw_tx: "0x02",
				},
			])
			.execute();
		await db
			.insertInto("events")
			.values([
				{
					tx_id: "tx-tail-1",
					block_height: 1,
					event_index: 0,
					type: "stx_transfer_event",
					data: { sender: "SP1", recipient: "SP2", amount: "1" },
				},
				{
					tx_id: "tx-tail-2",
					block_height: 1,
					event_index: 0,
					type: "stx_mint_event",
					data: { recipient: "SP2", amount: "2" },
				},
			])
			.execute();

		const page = await readCanonicalStreamsEvents({
			fromHeight: 1,
			toHeight: 1,
			types: ["print"],
			limit: 2,
			db,
		});

		expect(page.events).toEqual([]);
		expect(page.next_cursor).toBeNull();
	});
});
