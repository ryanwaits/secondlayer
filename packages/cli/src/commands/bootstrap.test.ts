import { describe, expect, test } from "bun:test";
import { archiveScopeBounds } from "./bootstrap.ts";

describe("archiveScopeBounds", () => {
	test("start is the archive's lowest partition, not its high-water mark", () => {
		const bounds = archiveScopeBounds([
			{ from_block: 8_200_000, to_block: 8_299_999 },
			{ from_block: 8_000_000, to_block: 8_099_999 },
			{ from_block: 8_100_000, to_block: 8_199_999 },
		]);
		expect(bounds).toEqual({
			start_height: 8_000_000,
			tip_height: 8_299_999,
		});
	});

	test("a genesis-rooted archive starts at zero", () => {
		expect(
			archiveScopeBounds([
				{ from_block: 0, to_block: 99_999 },
				{ from_block: 100_000, to_block: 199_999 },
			]),
		).toEqual({ start_height: 0, tip_height: 199_999 });
	});

	test("interleaved datasets share one pair of bounds", () => {
		// blocks/transactions/events partitions arrive mixed; the bounds are of
		// the restored range, not of any one dataset.
		expect(
			archiveScopeBounds([
				{ from_block: 4_000_000, to_block: 4_099_999 },
				{ from_block: 4_000_000, to_block: 4_099_999 },
				{ from_block: 4_100_000, to_block: 4_199_999 },
			]),
		).toEqual({ start_height: 4_000_000, tip_height: 4_199_999 });
	});

	test("no partitions means no declarable scope", () => {
		expect(archiveScopeBounds([])).toBeNull();
	});
});
