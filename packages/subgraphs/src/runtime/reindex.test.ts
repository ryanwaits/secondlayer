import { describe, expect, test } from "bun:test";
import type { SubgraphDefinition } from "../types.ts";
import type { BlockSource } from "./block-source.ts";
import {
	type ReindexOptions,
	initialReindexProgressBlock,
	resolveBlockRange,
	resolveReindexResumeBlock,
} from "./reindex.ts";

/**
 * The reindex walk range doubles as the subgraph's surviving data: the schema
 * drop ahead of it is unconditional. So the range must always be the whole
 * subgraph — `[start_block, chain tip]` — and nothing a caller passes may
 * narrow it (f079). The only permitted adjustment is the free-tier policy
 * floor, which raises the start and never bounds the end.
 */
describe("reindex range is always the whole subgraph", () => {
	const TIP = 9_000;
	const source = {
		getTip: async () => TIP,
		loadBlockRange: async () => new Map(),
	} as unknown as BlockSource;

	const def = { name: "sg", startBlock: 500 } as unknown as SubgraphDefinition;

	test("with no options, walks the definition start block to chain tip", async () => {
		expect(await resolveBlockRange(source, def)).toEqual({
			fromBlock: 500,
			toBlock: TIP,
		});
	});

	test("a definition with no start block walks from block 1", async () => {
		const genesis = { name: "sg" } as unknown as SubgraphDefinition;
		expect(await resolveBlockRange(source, genesis)).toEqual({
			fromBlock: 1,
			toBlock: TIP,
		});
	});

	test("a caller-supplied block range cannot narrow the walk", async () => {
		// The exact shape of the production incident, forced past the type
		// system the way a stale caller would: a single-block range. Pre-fix
		// this resolved to { fromBlock: 8255739, toBlock: 8255739 } and the
		// unconditional DROP SCHEMA then destroyed everything outside it.
		const ranged = {
			fromBlock: 8_255_739,
			toBlock: 8_255_739,
		} as unknown as ReindexOptions;
		expect(await resolveBlockRange(source, def, ranged)).toEqual({
			fromBlock: 500,
			toBlock: TIP,
		});
	});

	test("the free-tier floor raises the start block above the definition's", async () => {
		expect(
			await resolveBlockRange(source, def, { startBlockFloor: 2_000 }),
		).toEqual({ fromBlock: 2_000, toBlock: TIP });
	});

	test("a floor below the definition start never lowers the walk", async () => {
		expect(
			await resolveBlockRange(source, def, { startBlockFloor: 10 }),
		).toEqual({ fromBlock: 500, toBlock: TIP });
	});

	test("the floor never bounds the end — it always runs to chain tip", async () => {
		const { toBlock } = await resolveBlockRange(source, def, {
			startBlockFloor: 8_999,
		});
		expect(toBlock).toBe(TIP);
	});
});

describe("reindex resume cursor", () => {
	test("initial cursor starts before the reindex range", () => {
		expect(initialReindexProgressBlock(1)).toBe(0);
		expect(initialReindexProgressBlock(250)).toBe(249);
		expect(initialReindexProgressBlock(0)).toBe(0);
	});

	test("resume starts at the larger of recorded progress and reindex start", () => {
		expect(
			resolveReindexResumeBlock({
				last_processed_block: 0,
				reindex_from_block: 100,
				reindex_to_block: 500,
			}),
		).toBe(100);

		expect(
			resolveReindexResumeBlock({
				last_processed_block: 349,
				reindex_from_block: 100,
				reindex_to_block: 500,
			}),
		).toBe(350);
	});

	test("legacy rows without metadata trigger a fresh reindex", () => {
		expect(
			resolveReindexResumeBlock({
				last_processed_block: 500,
				reindex_from_block: null,
				reindex_to_block: null,
			}),
		).toBeNull();
	});
});
