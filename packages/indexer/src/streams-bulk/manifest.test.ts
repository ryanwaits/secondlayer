import { describe, expect, test } from "bun:test";
import {
	type StreamsBulkManifestFile,
	createStreamsBulkManifest,
	mergeStreamsBulkManifestFiles,
} from "./manifest.ts";

function file(
	fromBlock: number,
	toBlock: number,
	overrides: Partial<StreamsBulkManifestFile> = {},
): StreamsBulkManifestFile {
	return {
		path: `events/block_height/${fromBlock}-${toBlock}/events.parquet`,
		from_block: fromBlock,
		to_block: toBlock,
		min_cursor: `${fromBlock}:0`,
		max_cursor: `${toBlock}:0`,
		row_count: 100,
		byte_size: 1024,
		sha256: "deadbeef",
		schema_version: 0,
		created_at: "2026-06-12T00:00:00.000Z",
		...overrides,
	};
}

const META = {
	network: "mainnet",
	generatedAt: "2026-06-12T00:00:00.000Z",
	producerVersion: "@secondlayer/indexer@test",
	finalityLagBlocks: 144,
};

describe("mergeStreamsBulkManifestFiles", () => {
	test("unions disjoint file sets", () => {
		const merged = mergeStreamsBulkManifestFiles(
			[file(0, 9999)],
			[file(10000, 19999)],
		);
		expect(merged.map((f) => f.from_block).sort((a, b) => a - b)).toEqual([
			0, 10000,
		]);
	});

	test("dedups by path, incoming wins", () => {
		const merged = mergeStreamsBulkManifestFiles(
			[file(0, 9999, { sha256: "old" })],
			[file(0, 9999, { sha256: "new" })],
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.sha256).toBe("new");
	});
});

describe("cumulative latest manifest", () => {
	test("coverage and latest_finalized_cursor span the full unioned set", () => {
		const files = mergeStreamsBulkManifestFiles(
			[file(0, 9999), file(10000, 19999)],
			[file(20000, 29999)],
		);
		const manifest = createStreamsBulkManifest({ ...META, files });

		// Sorted by block range regardless of merge order.
		expect(manifest.files.map((f) => f.from_block)).toEqual([0, 10000, 20000]);
		// Coverage spans first..last, finalized cursor is the newest window's max.
		expect(manifest.coverage).toEqual({ from_block: 0, to_block: 29999 });
		expect(manifest.latest_finalized_cursor).toBe("29999:0");
	});
});
