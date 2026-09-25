import { beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	type DecodedTipReader,
	type IndexSourceTipReader,
	type IndexTip,
	committedHeightForEventTypes,
	createIndexTipProvider,
	getDecoderCommittedHeights,
	getIndexLagSeconds,
} from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;

function sourceTip(height: number, ts: Date): IndexSourceTipReader {
	return async () => ({
		block_height: height,
		block_hash: `0x${height.toString(16).padStart(64, "0")}`,
		burn_block_height: height + 1000,
		ts,
	});
}

describe("Index tip provider", () => {
	test("returns block_height from the decoded tip and finalized_height from source", async () => {
		const provider = createIndexTipProvider({
			// Canonical chain tip is 30_000, but the decoder has only reached 29_900.
			readSourceTip: sourceTip(30_000, new Date(1000)),
			readDecodedTip: async () => ({
				block_height: 29_900,
				ts: new Date(1000),
			}),
			readFinalizedHeight: async () => 29_994,
			now: () => 4000,
		});

		await expect(provider()).resolves.toEqual({
			block_height: 29_900,
			finalized_height: 29_994,
			lag_seconds: 3,
			source_block_height: 30_000,
			decoded_heights: {},
		});
	});

	test("carries the per-type committed-height map from readDecodedHeights", async () => {
		const provider = createIndexTipProvider({
			readSourceTip: sourceTip(30_000, new Date(1000)),
			readDecodedTip: async () => ({
				block_height: 29_900,
				ts: new Date(1000),
			}),
			readDecodedHeights: async () => ({
				ft_transfer: 29_900,
				stx_transfer: 29_850,
			}),
			readFinalizedHeight: async () => 29_994,
			now: () => 4000,
		});

		const tip = await provider();
		expect(tip.decoded_heights).toEqual({
			ft_transfer: 29_900,
			stx_transfer: 29_850,
		});
	});

	test("maps the burn-confirmation boundary to a finalized Stacks height", async () => {
		const seen: number[] = [];
		const provider = createIndexTipProvider({
			readSourceTip: sourceTip(30_000, new Date(0)),
			readDecodedTip: async () => ({ block_height: 30_000, ts: new Date(0) }),
			btcConfirmations: 6,
			readFinalizedHeight: async (burnCutoff) => {
				seen.push(burnCutoff);
				return 29_990;
			},
			now: () => 0,
		});

		const tip = await provider();
		// burn tip 31_000 - 6 confirmations = 30_994 passed to the reader.
		expect(seen).toEqual([30_994]);
		expect(tip.finalized_height).toBe(29_990);
	});

	test("falls back to the source tip block when no decoded tip exists", async () => {
		const provider = createIndexTipProvider({
			readSourceTip: sourceTip(30_000, new Date(0)),
			readDecodedTip: async () => null,
			readFinalizedHeight: async () => 29_994,
			now: () => 0,
		});

		const tip = await provider();
		expect(tip.block_height).toBe(30_000);
		expect(tip.finalized_height).toBe(29_994);
		expect(tip.source_block_height).toBe(30_000);
	});

	test("throws when no canonical block and empty tip is disallowed (platform)", async () => {
		const provider = createIndexTipProvider({
			readSourceTip: async () => null,
			allowEmptyTip: false,
		});
		await expect(provider()).rejects.toThrow("Index tip unavailable");
	});

	test("serves a zero tip when no canonical block and empty tip is allowed (oss)", async () => {
		const provider = createIndexTipProvider({
			readSourceTip: async () => null,
			allowEmptyTip: true,
		});
		await expect(provider()).resolves.toEqual({
			block_height: 0,
			finalized_height: 0,
			lag_seconds: 0,
			source_block_height: 0,
			decoded_heights: {},
		});
	});

	test("lag_seconds clamps to 0 on negative clock skew", () => {
		expect(getIndexLagSeconds(new Date(2000), 1000)).toBe(0);
	});

	test("cache returns the same value within the cache window", async () => {
		let calls = 0;
		let nowMs = 1000;
		const readDecodedTip: DecodedTipReader = async () => {
			calls++;
			return { block_height: calls, ts: new Date(0) };
		};
		const provider = createIndexTipProvider({
			readSourceTip: sourceTip(30_000, new Date(0)),
			readDecodedTip,
			readFinalizedHeight: async () => 0,
			now: () => nowMs,
			cacheTtlMs: 500,
		});

		const first = await provider();
		nowMs = 1499;
		const second = await provider();

		expect(calls).toBe(1);
		expect(second).toEqual(first);
	});

	test("cache refreshes after the cache window expires", async () => {
		let calls = 0;
		let nowMs = 1000;
		const readDecodedTip: DecodedTipReader = async () => {
			calls++;
			return { block_height: calls, ts: new Date(0) };
		};
		const provider = createIndexTipProvider({
			readSourceTip: sourceTip(30_000, new Date(0)),
			readDecodedTip,
			readFinalizedHeight: async () => 0,
			now: () => nowMs,
			cacheTtlMs: 500,
		});

		const first = await provider();
		nowMs = 1500;
		const second = await provider();

		expect(calls).toBe(2);
		expect(first.block_height).toBe(1);
		expect(second.block_height).toBe(2);
	});
});

describe("committedHeightForEventTypes", () => {
	const tip: IndexTip = {
		block_height: 100,
		finalized_height: 90,
		lag_seconds: 0,
		decoded_heights: { ft_transfer: 100, stx_transfer: 80, print: 95 },
	};

	test("returns the single type's own committed height", () => {
		expect(committedHeightForEventTypes(tip, ["stx_transfer"])).toBe(80);
	});

	test("returns the MIN across several types, not any single one of them", () => {
		expect(
			committedHeightForEventTypes(tip, [
				"ft_transfer",
				"stx_transfer",
				"print",
			]),
		).toBe(80);
	});

	test("null when a requested type has no entry in decoded_heights", () => {
		expect(committedHeightForEventTypes(tip, ["nft_transfer"])).toBeNull();
	});

	test("null when a requested type's decoder has no checkpoint yet (null, not missing)", () => {
		const notStarted: IndexTip = {
			...tip,
			decoded_heights: { ...tip.decoded_heights, nft_transfer: null },
		};
		expect(
			committedHeightForEventTypes(notStarted, ["nft_transfer"]),
		).toBeNull();
		expect(
			committedHeightForEventTypes(notStarted, ["ft_transfer", "nft_transfer"]),
		).toBeNull();
	});

	test("null when the tip carries no decoded_heights map at all", () => {
		const bare: IndexTip = {
			block_height: 100,
			finalized_height: 90,
			lag_seconds: 0,
		};
		expect(committedHeightForEventTypes(bare, ["ft_transfer"])).toBeNull();
	});

	test("null for an empty type list", () => {
		expect(committedHeightForEventTypes(tip, [])).toBeNull();
	});
});

describe.skipIf(!HAS_DB)("getDecoderCommittedHeights (DB)", () => {
	const db = HAS_DB ? getDb() : null;
	const DECODER_NAMES = [
		"decode.ft_transfer.v1",
		"decode.nft_transfer.v1",
		"decode.stx_transfer.v1",
		"decode.stx_mint.v1",
		"decode.stx_burn.v1",
		"decode.stx_lock.v1",
		"decode.ft_mint.v1",
		"decode.ft_burn.v1",
		"decode.nft_mint.v1",
		"decode.nft_burn.v1",
		"decode.print.v1",
	];

	beforeEach(async () => {
		if (!db) return;
		await db
			.deleteFrom("decoder_checkpoints")
			.where("decoder_name", "in", DECODER_NAMES)
			.execute();
	});

	test("computes the committed height per decoder from its checkpoint cursor", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("decoder_checkpoints")
			.values([
				// Sentinel event_index: block 100 is fully committed.
				{
					decoder_name: "decode.ft_transfer.v1",
					last_cursor: "100:2147483647",
				},
				// Mid-block: only up through 79 is committed.
				{ decoder_name: "decode.stx_transfer.v1", last_cursor: "80:3" },
			])
			.execute();

		const heights = await getDecoderCommittedHeights(db);
		expect(heights.ft_transfer).toBe(100);
		expect(heights.stx_transfer).toBe(79);
	});

	test("a decoder with no checkpoint row reports null, not height 0", async () => {
		if (!db) throw new Error("missing db");
		const heights = await getDecoderCommittedHeights(db);
		expect(heights.ft_transfer).toBeNull();
		expect(heights.print).toBeNull();
	});
});
