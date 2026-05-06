import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type DatasetManifest,
	datasetFreshness,
	datasetSources,
	resetDatasetManifestCache,
} from "./manifests.ts";

const SAMPLE_MANIFEST: DatasetManifest = {
	dataset: "stx-transfers",
	network: "mainnet",
	version: "v0",
	schema_version: 0,
	generated_at: "2026-05-05T12:34:56.000Z",
	producer_version: "@secondlayer/indexer@1.0.7",
	finality_lag_blocks: 144,
	latest_finalized_cursor: "189999:42",
	coverage: { from_block: 180000, to_block: 189999 },
	files: [],
};

describe("datasetFreshness", () => {
	test("reports unavailable when manifest missing", () => {
		expect(
			datasetFreshness({
				slug: "stx-transfers",
				manifest: null,
				chainTip: 200_000,
			}),
		).toEqual({
			slug: "stx-transfers",
			status: "unavailable",
			latest_finalized_cursor: null,
			generated_at: null,
			to_block: null,
			lag_blocks: null,
		});
	});

	test("computes lag from chain tip", () => {
		expect(
			datasetFreshness({
				slug: "stx-transfers",
				manifest: SAMPLE_MANIFEST,
				chainTip: 195_000,
			}),
		).toEqual({
			slug: "stx-transfers",
			status: "ok",
			latest_finalized_cursor: "189999:42",
			generated_at: "2026-05-05T12:34:56.000Z",
			to_block: 189_999,
			lag_blocks: 5_001,
		});
	});

	test("clamps negative lag to zero", () => {
		const result = datasetFreshness({
			slug: "stx-transfers",
			manifest: SAMPLE_MANIFEST,
			chainTip: 100_000,
		});
		expect(result.lag_blocks).toBe(0);
	});
});

describe("datasetSources", () => {
	const previous = process.env.DATASETS_PUBLIC_BASE_URL;

	beforeEach(() => {
		resetDatasetManifestCache();
	});

	afterEach(() => {
		if (previous === undefined) {
			delete process.env.DATASETS_PUBLIC_BASE_URL;
		} else {
			process.env.DATASETS_PUBLIC_BASE_URL = previous;
		}
	});

	test("returns null manifestUrl when env unset", () => {
		delete process.env.DATASETS_PUBLIC_BASE_URL;
		const sources = datasetSources();
		expect(sources).toEqual([{ slug: "stx-transfers", manifestUrl: null }]);
	});

	test("strips trailing slash and appends per-dataset path", () => {
		process.env.DATASETS_PUBLIC_BASE_URL =
			"https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev/stacks-datasets/mainnet/v0/";
		const sources = datasetSources();
		expect(sources[0]?.manifestUrl).toBe(
			"https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev/stacks-datasets/mainnet/v0/stx-transfers/manifest/latest.json",
		);
	});
});
