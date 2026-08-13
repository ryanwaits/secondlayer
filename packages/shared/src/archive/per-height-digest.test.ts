import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PerHeightDigestAccumulator } from "./per-height-digest.ts";

const sha256HexOfBytes = (...hex: string[]) => {
	const h = createHash("sha256");
	for (const s of hex) h.update(Buffer.from(s, "hex"));
	return h.digest("hex");
};

describe("PerHeightDigestAccumulator", () => {
	test("empty range produces no rows", () => {
		const a = new PerHeightDigestAccumulator();
		expect(a.drain(0, 9)).toEqual([]);
	});

	test("block-only heights emit block digest with null rollups", () => {
		const a = new PerHeightDigestAccumulator();
		a.setBlockDigest(500_000, "aabb");
		const rows = a.drain(500_000, 500_000);
		expect(rows).toEqual([
			{
				height: 500_000,
				block_digest: "aabb",
				transactions_rollup: null,
				events_rollup: null,
			},
		]);
	});

	test("transactions and events roll up as sha256 of concatenated bytes", () => {
		const a = new PerHeightDigestAccumulator();
		a.setBlockDigest(500_000, "aabb");
		a.appendTransactionDigest(500_000, "1111");
		a.appendTransactionDigest(500_000, "2222");
		a.appendEventDigest(500_000, "3333");
		const row = a.drain(500_000, 500_000)[0];
		expect(row.transactions_rollup).toBe(sha256HexOfBytes("1111", "2222"));
		expect(row.events_rollup).toBe(sha256HexOfBytes("3333"));
	});

	test("drain fills the range in ascending order and skips heights we never saw", () => {
		const a = new PerHeightDigestAccumulator();
		a.setBlockDigest(2, "22");
		a.setBlockDigest(0, "00");
		const rows = a.drain(0, 3);
		expect(rows.map((r) => r.height)).toEqual([0, 2]);
	});

	test("tx or event without a block digest is refused loudly", () => {
		const a = new PerHeightDigestAccumulator();
		a.appendTransactionDigest(500_000, "1111");
		expect(() => a.drain(500_000, 500_000)).toThrow(/no block digest/);
	});

	test("drain is repeatable — the hashers aren't consumed", () => {
		const a = new PerHeightDigestAccumulator();
		a.setBlockDigest(1, "01");
		a.appendTransactionDigest(1, "aa");
		const first = a.drain(1, 1);
		const second = a.drain(1, 1);
		expect(first).toEqual(second);
	});
});
