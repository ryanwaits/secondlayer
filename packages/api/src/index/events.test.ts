import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import {
	getIndexEventsResponse,
	parseIndexEventsQuery,
	readIndexEvents,
} from "./events.ts";
import { readFtTransfers } from "./ft-transfers.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = { block_height: 30_000, lag_seconds: 3 };
const OUTSIDE_DEFAULT_WINDOW_HEIGHT =
	TIP.block_height - STREAMS_BLOCKS_PER_DAY - 1;

function params(query: string) {
	return new URL(`http://localhost/v1/index/events${query}`).searchParams;
}

describe("Index /events query parsing", () => {
	test("event_type is required", () => {
		expect(() => parseIndexEventsQuery(params(""), TIP)).toThrow(
			"event_type is required",
		);
	});

	test("unknown event_type is rejected", () => {
		expect(() =>
			parseIndexEventsQuery(params("?event_type=contract_call"), TIP),
		).toThrow("unknown event_type");
	});

	test("asset_identifier is rejected for ft_transfer", () => {
		expect(() =>
			parseIndexEventsQuery(
				params("?event_type=ft_transfer&asset_identifier=SP1.t::c"),
				TIP,
			),
		).toThrow("unknown query param: asset_identifier");
	});

	test("asset_identifier is allowed for nft_transfer", () => {
		const parsed = parseIndexEventsQuery(
			params("?event_type=nft_transfer&asset_identifier=SP1.nft::item"),
			TIP,
		);
		expect(parsed.filters.asset_identifier).toBe("SP1.nft::item");
	});

	test("defaults to last day when no explicit height or cursor is provided", () => {
		const parsed = parseIndexEventsQuery(
			params("?event_type=ft_transfer"),
			TIP,
		);
		expect(parsed.fromHeight).toBe(
			Math.max(0, TIP.block_height - STREAMS_BLOCKS_PER_DAY),
		);
	});

	test("from_cursor=0:0 bypasses default window", () => {
		const parsed = parseIndexEventsQuery(
			params("?event_type=ft_transfer&from_cursor=0:0"),
			TIP,
		);
		expect(parsed.cursor).toEqual({ block_height: 0, event_index: 0 });
		expect(parsed.fromHeight).toBe(0);
	});
});

describe("Index /events response", () => {
	test("successful responses always include reorgs array", async () => {
		const response = await getIndexEventsResponse({
			query: params("?event_type=ft_transfer&from_height=0"),
			tip: TIP,
			readEvents: async () => ({ events: [], next_cursor: null }),
		});
		expect(response.reorgs).toEqual([]);
	});

	test("forwards event_type to the reader and includes overlapping reorgs", async () => {
		let seenEventType: string | undefined;
		const response = await getIndexEventsResponse({
			query: params("?event_type=nft_transfer&from_height=0"),
			tip: TIP,
			readEvents: async (readParams) => {
				seenEventType = readParams.eventType;
				return {
					events: [
						{
							cursor: "10:0",
							block_height: 10,
							tx_id: "0x01",
							tx_index: 0,
							event_index: 0,
							event_type: "nft_transfer",
							contract_id: "SP123.nft",
							asset_identifier: "SP123.nft::item",
							sender: "SP123.sender",
							recipient: "SP123.recipient",
							value: "u1",
						},
					],
					next_cursor: "10:0",
				};
			},
			readReorgs: async (range) => [
				{
					id: "reorg-1",
					detected_at: "2026-05-03T12:30:00.000Z",
					fork_point_height: range.from.block_height,
					old_index_block_hash: "0xold",
					new_index_block_hash: "0xnew",
					orphaned_range: { from: "10:0", to: "10:0" },
					new_canonical_tip: "10:0",
				},
			],
		});

		expect(seenEventType).toBe("nft_transfer");
		expect(response.reorgs.map((reorg) => reorg.id)).toEqual(["reorg-1"]);
	});

	test("cursor past tip short-circuits with the raw cursor echoed back", async () => {
		const response = await getIndexEventsResponse({
			query: params(
				`?event_type=ft_transfer&from_cursor=${TIP.block_height + 1}:0`,
			),
			tip: TIP,
			readEvents: async () => {
				throw new Error("reader should not run when cursor is past tip");
			},
		});
		expect(response.events).toEqual([]);
		expect(response.next_cursor).toBe(`${TIP.block_height + 1}:0`);
	});
});

describe.skipIf(!HAS_DB)("Index /events DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM decoded_events`.execute(db);
	});

	test("ft_transfer reads match the typed readFtTransfers path", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("decoded_events")
			.values([
				ftRow("9900:0", 9900, "SP1.token", "SP1", "SP2", "10"),
				ftRow("9901:0", 9901, "SP2.token", "SP4", "SP2", "30"),
				nftRow(
					`${OUTSIDE_DEFAULT_WINDOW_HEIGHT}:0`,
					OUTSIDE_DEFAULT_WINDOW_HEIGHT,
				),
			])
			.execute();

		const viaEvents = await readIndexEvents({
			db,
			eventType: "ft_transfer",
			fromHeight: 0,
			toHeight: 10_000,
			limit: 10,
		});
		const viaTyped = await readFtTransfers({
			db,
			fromHeight: 0,
			toHeight: 10_000,
			limit: 10,
		});

		expect(viaEvents.events.map((e) => e.cursor)).toEqual(["9900:0", "9901:0"]);
		expect(viaEvents).toEqual(viaTyped);
	});

	test("event_type filter excludes other decoded event types", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("decoded_events")
			.values([
				ftRow("9900:0", 9900, "SP1.token", "SP1", "SP2", "10"),
				nftRow("9900:1", 9900),
			])
			.execute();

		const ftOnly = await readIndexEvents({
			db,
			eventType: "ft_transfer",
			fromHeight: 0,
			toHeight: 10_000,
			limit: 10,
		});
		expect(ftOnly.events.map((e) => e.cursor)).toEqual(["9900:0"]);

		const nftOnly = await readIndexEvents({
			db,
			eventType: "nft_transfer",
			fromHeight: 0,
			toHeight: 10_000,
			limit: 10,
		});
		expect(nftOnly.events.map((e) => e.cursor)).toEqual(["9900:1"]);
	});
});

function ftRow(
	cursor: string,
	blockHeight: number,
	contractId: string,
	sender: string,
	recipient: string,
	amount: string,
) {
	return {
		cursor,
		block_height: blockHeight,
		tx_id: `tx-${cursor}`,
		tx_index: 0,
		event_index: Number(cursor.split(":")[1]),
		event_type: "ft_transfer",
		contract_id: contractId,
		asset_identifier: `${contractId}::token`,
		sender,
		recipient,
		amount,
		source_cursor: cursor,
	};
}

function nftRow(cursor: string, blockHeight = Number(cursor.split(":")[0])) {
	return {
		cursor,
		block_height: blockHeight,
		tx_id: `tx-${cursor}`,
		tx_index: 0,
		event_index: Number(cursor.split(":")[1]),
		event_type: "nft_transfer",
		contract_id: "SP1.nft",
		asset_identifier: "SP1.nft::item",
		sender: "SP1",
		recipient: "SP2",
		value: "u1",
		source_cursor: cursor,
	};
}
