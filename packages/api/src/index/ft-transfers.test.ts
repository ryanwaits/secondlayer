import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import {
	getFtTransfersResponse,
	parseFtTransfersQuery,
	readFtTransfers,
} from "./ft-transfers.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};
const OUTSIDE_DEFAULT_WINDOW_HEIGHT =
	TIP.block_height - STREAMS_BLOCKS_PER_DAY - 1;
const INSIDE_DEFAULT_WINDOW_HEIGHT = TIP.block_height - 100;

function params(query: string) {
	return new URL(`http://localhost/v1/index/ft-transfers${query}`).searchParams;
}

describe("Index ft-transfers helpers", () => {
	test("defaults to last day when no explicit height or cursor is provided", () => {
		const parsed = parseFtTransfersQuery(params(""), TIP);
		expect(parsed.fromHeight).toBe(
			Math.max(0, TIP.block_height - STREAMS_BLOCKS_PER_DAY),
		);
	});

	test("from_height=0 bypasses default window", () => {
		const parsed = parseFtTransfersQuery(params("?from_height=0"), TIP);
		expect(parsed.fromHeight).toBe(0);
	});

	test("from_cursor=0:0 bypasses default window", () => {
		const parsed = parseFtTransfersQuery(params("?from_cursor=0:0"), TIP);
		expect(parsed.cursor).toEqual({ block_height: 0, event_index: 0 });
		expect(parsed.fromHeight).toBe(0);
	});

	test("successful responses always include reorgs array", async () => {
		const response = await getFtTransfersResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readTransfers: async () => ({ events: [], next_cursor: null }),
		});
		expect(response.reorgs).toEqual([]);
	});

	test("successful responses include overlapping reorgs", async () => {
		const response = await getFtTransfersResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readTransfers: async () => ({
				events: [
					{
						cursor: "10:0",
						block_height: 10,
						tx_id: "0x01",
						tx_index: 0,
						event_index: 0,
						event_type: "ft_transfer",
						contract_id: "SP123.token",
						asset_identifier: "SP123.token::coin",
						sender: "SP123.sender",
						recipient: "SP123.recipient",
						amount: "1",
					},
				],
				next_cursor: "10:0",
			}),
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

		expect(response.reorgs.map((reorg) => reorg.id)).toEqual(["reorg-1"]);
	});
});

describe("Index ft-transfers field projection", () => {
	test("fields are parsed and threaded to the reader", async () => {
		const response = await getFtTransfersResponse({
			query: params("?from_height=0&fields=amount,sender"),
			tip: TIP,
			readTransfers: async (readParams) => {
				expect(readParams.fields).toEqual(["amount", "sender"]);
				return { events: [], next_cursor: null };
			},
		});
		expect(response.events).toEqual([]);
	});

	test("an unknown field is refused, not silently dropped", () => {
		expect(() =>
			parseFtTransfersQuery(params("?fields=amount,sendr"), TIP),
		).toThrow(/unknown field: sendr/);
	});

	test("omitting fields leaves the reader unprojected", async () => {
		await getFtTransfersResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readTransfers: async (readParams) => {
				expect(readParams.fields).toBeUndefined();
				return { events: [], next_cursor: null };
			},
		});
	});

	test("reorg lookup uses the raw span when the projection dropped event_index", async () => {
		const ranges: Array<{ from: number; to: number }> = [];
		await getFtTransfersResponse({
			query: params("?from_height=0&fields=amount"),
			tip: TIP,
			readTransfers: async () => ({
				// Projected rows carry no event_index; the span travels separately.
				events: [
					{ cursor: "10:2", block_height: 10, amount: "1" } as never,
					{ cursor: "12:5", block_height: 12, amount: "2" } as never,
				],
				next_cursor: "12:5",
				span: {
					from: { block_height: 10, event_index: 2 },
					to: { block_height: 12, event_index: 5 },
				},
			}),
			readReorgs: async (range) => {
				ranges.push({
					from: range.from.block_height,
					to: range.to.block_height,
				});
				return [];
			},
		});
		expect(ranges).toEqual([{ from: 10, to: 12 }]);
	});
});

describe.skipIf(!HAS_DB)("Index ft-transfers DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM decoded_events`.execute(db);
	});

	test("filters in SQL by contract, sender, recipient, and height", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("decoded_events")
			.values([
				row("9000:0", 9000, "SP1.token", "SP1", "SP2", "10"),
				row("9900:0", 9900, "SP1.token", "SP1", "SP3", "20"),
				row("9901:0", 9901, "SP2.token", "SP4", "SP2", "30"),
			])
			.execute();

		await expect(
			readFtTransfers({ db, fromHeight: 0, toHeight: 10_000, limit: 10 }),
		).resolves.toMatchObject({
			events: [
				{ cursor: "9000:0" },
				{ cursor: "9900:0" },
				{ cursor: "9901:0" },
			],
		});
		await expect(
			readFtTransfers({
				db,
				fromHeight: 0,
				toHeight: 10_000,
				contractId: "SP1.token",
				limit: 10,
			}),
		).resolves.toMatchObject({
			events: [{ cursor: "9000:0" }, { cursor: "9900:0" }],
		});
		await expect(
			readFtTransfers({
				db,
				fromHeight: 0,
				toHeight: 10_000,
				sender: "SP1",
				limit: 10,
			}),
		).resolves.toMatchObject({
			events: [{ cursor: "9000:0" }, { cursor: "9900:0" }],
		});
		// asset_identifier filters ft rows like it always did nft rows — the
		// unified filter union projects it to both.
		await expect(
			readFtTransfers({
				db,
				fromHeight: 0,
				toHeight: 10_000,
				assetIdentifier: "SP1.token::token",
				limit: 10,
			}),
		).resolves.toMatchObject({
			events: [{ cursor: "9000:0" }, { cursor: "9900:0" }],
		});
		await expect(
			readFtTransfers({
				db,
				fromHeight: 0,
				toHeight: 10_000,
				recipient: "SP2",
				limit: 10,
			}),
		).resolves.toMatchObject({
			events: [{ cursor: "9000:0" }, { cursor: "9901:0" }],
		});
		await expect(
			readFtTransfers({
				db,
				fromHeight: 9900,
				toHeight: 9900,
				limit: 10,
			}),
		).resolves.toMatchObject({
			events: [{ cursor: "9900:0" }],
		});
	});

	test("cursor pagination returns rows after the cursor", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("decoded_events")
			.values([
				row("9900:0", 9900, "SP1.token", "SP1", "SP2", "10"),
				row("9900:1", 9900, "SP1.token", "SP1", "SP2", "20"),
				row("9901:0", 9901, "SP1.token", "SP1", "SP2", "30"),
			])
			.execute();

		const result = await readFtTransfers({
			db,
			after: { block_height: 9900, event_index: 0 },
			fromHeight: 0,
			toHeight: 10_000,
			limit: 1,
		});

		expect(result.events.map((event) => event.cursor)).toEqual(["9900:1"]);
		expect(result.next_cursor).toBe("9900:1");
	});

	test("default response window excludes older rows; from_height=0 includes them", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("decoded_events")
			.values([
				row(
					`${OUTSIDE_DEFAULT_WINDOW_HEIGHT}:0`,
					OUTSIDE_DEFAULT_WINDOW_HEIGHT,
					"SP1.token",
					"SP1",
					"SP2",
					"10",
				),
				row(
					`${INSIDE_DEFAULT_WINDOW_HEIGHT}:0`,
					INSIDE_DEFAULT_WINDOW_HEIGHT,
					"SP1.token",
					"SP1",
					"SP2",
					"20",
				),
			])
			.execute();

		const defaultResponse = await getFtTransfersResponse({
			query: params(""),
			tip: TIP,
			readTransfers: (readParams) => readFtTransfers({ ...readParams, db }),
		});
		const fullResponse = await getFtTransfersResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readTransfers: (readParams) => readFtTransfers({ ...readParams, db }),
		});

		expect(defaultResponse.events.map((event) => event.cursor)).toEqual([
			`${INSIDE_DEFAULT_WINDOW_HEIGHT}:0`,
		]);
		expect(fullResponse.events.map((event) => event.cursor)).toEqual([
			`${OUTSIDE_DEFAULT_WINDOW_HEIGHT}:0`,
			`${INSIDE_DEFAULT_WINDOW_HEIGHT}:0`,
		]);
		expect(defaultResponse.reorgs).toEqual([]);
		expect(fullResponse.reorgs).toEqual([]);
	});

	test("fields=amount returns only that column plus the always-kept set, without breaking pagination", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("decoded_events")
			.values([
				row("9900:0", 9900, "SP1.token", "SP1", "SP2", "10"),
				row("9900:1", 9900, "SP1.token", "SP1", "SP2", "20"),
			])
			.execute();

		const response = await getFtTransfersResponse({
			query: params("?from_height=0&fields=amount"),
			tip: TIP,
			readTransfers: (readParams) => readFtTransfers({ ...readParams, db }),
		});

		for (const event of response.events) {
			expect(
				Object.keys(event as unknown as Record<string, unknown>).sort(),
			).toEqual(["amount", "block_height", "cursor", "event_type"]);
		}
		// Cursor built from the RAW rows — pagination survives omitting event_index.
		expect(response.next_cursor).toBe("9900:1");
	});
});

function row(
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
