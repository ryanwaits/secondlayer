import { describe, expect, test } from "bun:test";
import {
	GENERIC_DECODER_PRODUCER_VERSION,
	classifyGenericDecodeFault,
	failureFromFaults,
	planGenericDecoderReceipts,
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

describe("producer version", () => {
	test("generic producers are v1", () => {
		expect(GENERIC_DECODER_PRODUCER_VERSION).toBe("v1");
	});
});
