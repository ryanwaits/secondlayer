import { describe, expect, test } from "bun:test";
import {
	classifyGenericDecodeFault,
	failureFromFaults,
	planGenericDecoderReceipts,
} from "./generic-commit.ts";

describe("protocol decoder coverage", () => {
	test("sparse history: unmatched prints are no-match receipts, not gaps", () => {
		const receipts = planGenericDecoderReceipts([
			{
				cursor: "200:0",
				block_height: 200,
				block_hash: "0xa",
				matched: false,
			},
			{
				cursor: "205:1",
				block_height: 205,
				block_hash: "0xb",
				matched: true,
			},
		]);
		expect(receipts[0]?.no_match).toBe(true);
		expect(receipts[1]?.no_match).toBe(false);
		expect(receipts.map((r) => r.height)).toEqual([200, 205]);
	});

	test("a reorg-shaped version fault is classified", () => {
		expect(
			classifyGenericDecodeFault(new Error("unknown decoder version")),
		).toBe("version");
		expect(
			failureFromFaults([
				{ cursor: "300:0", class: "version", error: "unknown decoder version" },
			])?.class,
		).toBe("version");
	});
});
