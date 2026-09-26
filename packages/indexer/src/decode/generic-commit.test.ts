import { describe, expect, test } from "bun:test";
import {
	GENERIC_DECODER_PRODUCER_VERSION,
	checkpointAdvance,
	classifyGenericDecodeFault,
	failureFromFaults,
	planGenericDecoderReceipts,
	shortPageCheckpointCursor,
} from "./generic-commit.ts";

describe("classifyGenericDecodeFault", () => {
	test("a missing payload field is an omission", () => {
		expect(
			classifyGenericDecodeFault(new Error("asset_identifier required")),
		).toBe("omission");
	});

	test("a version / schema mismatch is a version fault", () => {
		expect(classifyGenericDecodeFault(new Error("unsupported schema v2"))).toBe(
			"version",
		);
		expect(
			classifyGenericDecodeFault(new Error("unknown decoder version")),
		).toBe("version");
	});
});

describe("planGenericDecoderReceipts", () => {
	test("groups matched events per height and marks omitted ones no-match", () => {
		const receipts = planGenericDecoderReceipts([
			{
				cursor: "10:0",
				block_height: 10,
				block_hash: "0xa",
				matched: true,
			},
			{
				cursor: "10:1",
				block_height: 10,
				block_hash: "0xa",
				matched: false,
			},
			{
				cursor: "11:0",
				block_height: 11,
				block_hash: "0xb",
				matched: false,
			},
		]);
		expect(receipts).toHaveLength(2);
		expect(receipts[0]).toMatchObject({
			height: 10,
			hash: "0xa",
			input_count: 1,
			input_cursors: ["10:0"],
			no_match: false,
		});
		expect(receipts[1]).toMatchObject({
			height: 11,
			hash: "0xb",
			input_count: 0,
			no_match: true,
		});
	});
});

describe("failureFromFaults", () => {
	test("omission covers the omitted height range", () => {
		expect(
			failureFromFaults([
				{ cursor: "10:0", class: "omission", error: "bad payload" },
				{ cursor: "12:3", class: "omission", error: "bad payload" },
			]),
		).toEqual({
			unit_kind: "block",
			class: "omission",
			retry_state: "open",
			from_height: 10,
			to_height: 12,
			error: "bad payload",
		});
	});

	test("a version fault stays a version fault", () => {
		expect(
			failureFromFaults([
				{ cursor: "8:0", class: "version", error: "unknown decoder version" },
			])?.class,
		).toBe("version");
	});

	test("no faults means no failure row", () => {
		expect(failureFromFaults([])).toBeNull();
	});
});

describe("shortPageCheckpointCursor", () => {
	test("a page shorter than requested commits the end-of-block sentinel at the tip", () => {
		expect(
			shortPageCheckpointCursor({
				eventCount: 3,
				requestedBatchSize: 500,
				tipHeight: 150420,
				fallback: "150420:2",
			}),
		).toBe("150420:2147483647");
	});

	test("a full page falls back to the envelope cursor — the range may be truncated", () => {
		expect(
			shortPageCheckpointCursor({
				eventCount: 500,
				requestedBatchSize: 500,
				tipHeight: 150420,
				fallback: "150420:2",
			}),
		).toBe("150420:2");
	});

	test("an empty page falls back — that proof belongs to the reader's own sentinel, not this one", () => {
		expect(
			shortPageCheckpointCursor({
				eventCount: 0,
				requestedBatchSize: 500,
				tipHeight: 150420,
				fallback: "150420:2147483647",
			}),
		).toBe("150420:2147483647");
	});
});

describe("producer version", () => {
	test("generic producers are v1", () => {
		expect(GENERIC_DECODER_PRODUCER_VERSION).toBe("v1");
	});
});

describe("checkpointAdvance", () => {
	const EMPTY_RANGE_SENTINEL = 2_147_483_647;
	const events = [
		{ block_height: 100, ts: "2026-09-25T00:00:00.000Z" },
		{ block_height: 101, ts: "2026-09-25T00:00:12.000Z" },
	];

	test("null when the committed height doesn't move (mid-block bump)", () => {
		expect(checkpointAdvance("100:0", "100:1", events)).toBeNull();
	});

	test("the first-ever batch (starting from an uninitialized cursor) reports an advance", () => {
		expect(checkpointAdvance(null, "100:0", events)).toEqual({
			height: 99,
			blockTime: null,
		});
	});

	test("reports the newly committed height and its block's time", () => {
		expect(
			checkpointAdvance(
				`99:${EMPTY_RANGE_SENTINEL}`,
				`100:${EMPTY_RANGE_SENTINEL}`,
				events,
			),
		).toEqual({ height: 100, blockTime: "2026-09-25T00:00:00.000Z" });
	});

	test("a mid-block cursor advancing past a finished block still reports the committed height", () => {
		// Cursor moves from block 99 done → block 101 in flight: the committed
		// floor advances from 99 to 100, even though the raw cursor points at 101.
		expect(
			checkpointAdvance(`99:${EMPTY_RANGE_SENTINEL}`, "101:0", events),
		).toEqual({ height: 100, blockTime: "2026-09-25T00:00:00.000Z" });
	});

	test("null block_time when the advanced height's block isn't in this batch", () => {
		expect(
			checkpointAdvance(
				`99:${EMPTY_RANGE_SENTINEL}`,
				`100:${EMPTY_RANGE_SENTINEL}`,
				[],
			),
		).toEqual({ height: 100, blockTime: null });
	});
});
