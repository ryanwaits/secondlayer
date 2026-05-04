import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import {
	getNftTransfersResponse,
	parseNftTransfersQuery,
	readNftTransfers,
} from "./nft-transfers.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = { block_height: 30_000, lag_seconds: 3 };
const OUTSIDE_DEFAULT_WINDOW_HEIGHT =
	TIP.block_height - STREAMS_BLOCKS_PER_DAY - 1;
const INSIDE_DEFAULT_WINDOW_HEIGHT = TIP.block_height - 100;

function params(query: string) {
	return new URL(`http://localhost/v1/index/nft-transfers${query}`)
		.searchParams;
}

describe("Index nft-transfers helpers", () => {
	test("defaults to last day when no explicit height or cursor is provided", () => {
		const parsed = parseNftTransfersQuery(params(""), TIP);
		expect(parsed.fromHeight).toBe(
			Math.max(0, TIP.block_height - STREAMS_BLOCKS_PER_DAY),
		);
	});

	test("from_height=0 bypasses default window", () => {
		const parsed = parseNftTransfersQuery(params("?from_height=0"), TIP);
		expect(parsed.fromHeight).toBe(0);
	});

	test("from_cursor=0:0 bypasses default window", () => {
		const parsed = parseNftTransfersQuery(params("?from_cursor=0:0"), TIP);
		expect(parsed.cursor).toEqual({ block_height: 0, event_index: 0 });
		expect(parsed.fromHeight).toBe(0);
	});

	test("successful responses always include reorgs array", async () => {
		const response = await getNftTransfersResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readTransfers: async () => ({ events: [], next_cursor: null }),
		});
		expect(response.reorgs).toEqual([]);
	});
});

describe.skipIf(!HAS_DB)("Index nft-transfers DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM decoded_events`.execute(db);
	});

	test("filters in SQL by contract, asset, sender, recipient, and height", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("decoded_events")
			.values([
				row("9000:0", 9000, "SP1.collection", "SP1", "SP2", "0x01"),
				row("9900:0", 9900, "SP1.collection", "SP1", "SP3", "0x02"),
				row("9901:0", 9901, "SP2.collection", "SP4", "SP2", "0x03"),
			])
			.execute();

		await expect(
			readNftTransfers({ db, fromHeight: 0, toHeight: 10_000, limit: 10 }),
		).resolves.toMatchObject({
			events: [
				{ cursor: "9000:0" },
				{ cursor: "9900:0" },
				{ cursor: "9901:0" },
			],
		});
		await expect(
			readNftTransfers({
				db,
				fromHeight: 0,
				toHeight: 10_000,
				contractId: "SP1.collection",
				limit: 10,
			}),
		).resolves.toMatchObject({
			events: [{ cursor: "9000:0" }, { cursor: "9900:0" }],
		});
		await expect(
			readNftTransfers({
				db,
				fromHeight: 0,
				toHeight: 10_000,
				assetIdentifier: "SP1.collection::token",
				limit: 10,
			}),
		).resolves.toMatchObject({
			events: [{ cursor: "9000:0" }, { cursor: "9900:0" }],
		});
		await expect(
			readNftTransfers({
				db,
				fromHeight: 0,
				toHeight: 10_000,
				sender: "SP1",
				limit: 10,
			}),
		).resolves.toMatchObject({
			events: [{ cursor: "9000:0" }, { cursor: "9900:0" }],
		});
		await expect(
			readNftTransfers({
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
			readNftTransfers({
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
				row("9900:0", 9900, "SP1.collection", "SP1", "SP2", "0x01"),
				row("9900:1", 9900, "SP1.collection", "SP1", "SP2", "0x02"),
				row("9901:0", 9901, "SP1.collection", "SP1", "SP2", "0x03"),
			])
			.execute();

		const result = await readNftTransfers({
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
					"SP1.collection",
					"SP1",
					"SP2",
					"0x01",
				),
				row(
					`${INSIDE_DEFAULT_WINDOW_HEIGHT}:0`,
					INSIDE_DEFAULT_WINDOW_HEIGHT,
					"SP1.collection",
					"SP1",
					"SP2",
					"0x02",
				),
			])
			.execute();

		const defaultResponse = await getNftTransfersResponse({
			query: params(""),
			tip: TIP,
			readTransfers: (readParams) => readNftTransfers({ ...readParams, db }),
		});
		const fullResponse = await getNftTransfersResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readTransfers: (readParams) => readNftTransfers({ ...readParams, db }),
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
});

function row(
	cursor: string,
	blockHeight: number,
	contractId: string,
	sender: string,
	recipient: string,
	value: string,
) {
	return {
		cursor,
		block_height: blockHeight,
		tx_id: `tx-${cursor}`,
		tx_index: 0,
		event_index: Number(cursor.split(":")[1]),
		event_type: "nft_transfer",
		contract_id: contractId,
		asset_identifier: `${contractId}::token`,
		sender,
		recipient,
		value,
		source_cursor: cursor,
	};
}
