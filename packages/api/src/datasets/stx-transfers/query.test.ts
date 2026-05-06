import { describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import {
	getStxTransfersResponse,
	parseStxTransfersQuery,
	type StxTransferRow,
} from "./query.ts";

const TIP = { block_height: 200_000 };

describe("parseStxTransfersQuery", () => {
	test("defaults to one-day window and limit 200", () => {
		const parsed = parseStxTransfersQuery(new URLSearchParams(), TIP);
		// 17_280 blocks ≈ one day at 5s tenure cadence
		expect(parsed.fromBlock).toBe(200_000 - 17_280);
		expect(parsed.toBlock).toBe(200_000);
		expect(parsed.limit).toBe(200);
		expect(parsed.cursor).toBeUndefined();
	});

	test("cursor without from_block scans full range", () => {
		const parsed = parseStxTransfersQuery(
			new URLSearchParams({ cursor: "1:0" }),
			TIP,
		);
		expect(parsed.fromBlock).toBe(0);
	});

	test("parses sender/recipient filters", () => {
		const params = new URLSearchParams({
			sender: "SP1ABC",
			recipient: "SP2DEF",
		});
		const parsed = parseStxTransfersQuery(params, TIP);
		expect(parsed.sender).toBe("SP1ABC");
		expect(parsed.recipient).toBe("SP2DEF");
	});

	test("clamps to_block to tip", () => {
		const parsed = parseStxTransfersQuery(
			new URLSearchParams({ to_block: "999999" }),
			TIP,
		);
		expect(parsed.toBlock).toBe(200_000);
	});

	test("clamps limit to MAX_LIMIT", () => {
		const parsed = parseStxTransfersQuery(
			new URLSearchParams({ limit: "5000" }),
			TIP,
		);
		expect(parsed.limit).toBe(1000);
	});

	test("parses cursor", () => {
		const parsed = parseStxTransfersQuery(
			new URLSearchParams({ cursor: "180000:42" }),
			TIP,
		);
		expect(parsed.cursor).toEqual({ block_height: 180_000, event_index: 42 });
	});

	test("rejects cursor + from_block combo", () => {
		expect(() =>
			parseStxTransfersQuery(
				new URLSearchParams({ cursor: "1:0", from_block: "1" }),
				TIP,
			),
		).toThrow(ValidationError);
	});

	test("rejects malformed cursor", () => {
		expect(() =>
			parseStxTransfersQuery(new URLSearchParams({ cursor: "abc" }), TIP),
		).toThrow(ValidationError);
	});
});

describe("getStxTransfersResponse", () => {
	test("delegates to reader and returns next_cursor from last event", async () => {
		const sampleRow: StxTransferRow = {
			cursor: "180000:42",
			block_height: 180_000,
			block_time: "2026-05-05T12:34:56.000Z",
			tx_id: "0xabc",
			tx_index: 0,
			event_index: 42,
			sender: "SP1",
			recipient: "SP2",
			amount: "1000000",
			memo: null,
		};
		const response = await getStxTransfersResponse({
			query: new URLSearchParams(),
			tip: TIP,
			readTransfers: async (params) => {
				expect(params.fromBlock).toBe(200_000 - 17_280);
				expect(params.toBlock).toBe(200_000);
				return { events: [sampleRow], next_cursor: "180000:42" };
			},
		});
		expect(response.events).toHaveLength(1);
		expect(response.next_cursor).toBe("180000:42");
		expect(response.tip).toEqual(TIP);
	});
});
