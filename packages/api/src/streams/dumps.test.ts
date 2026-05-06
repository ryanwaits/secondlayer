import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	getStreamsBulkManifest,
	resetStreamsDumpsManifestCache,
	streamsDumpsFreshness,
	streamsDumpsManifestUrl,
	streamsDumpsPublicBaseUrl,
	type StreamsBulkManifest,
} from "./dumps.ts";

const SAMPLE_MANIFEST: StreamsBulkManifest = {
	dataset: "stacks-streams",
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

describe("streamsDumpsFreshness", () => {
	test("reports unavailable when manifest is missing", () => {
		expect(
			streamsDumpsFreshness({ manifest: null, chainTip: 200_000 }),
		).toEqual({
			status: "unavailable",
			latest_finalized_cursor: null,
			generated_at: null,
			to_block: null,
			lag_blocks: null,
		});
	});

	test("computes lag_blocks from chain tip and manifest coverage", () => {
		expect(
			streamsDumpsFreshness({ manifest: SAMPLE_MANIFEST, chainTip: 195_000 }),
		).toEqual({
			status: "ok",
			latest_finalized_cursor: "189999:42",
			generated_at: "2026-05-05T12:34:56.000Z",
			to_block: 189_999,
			lag_blocks: 5_001,
		});
	});

	test("clamps negative lag to zero when chain tip lags manifest", () => {
		const result = streamsDumpsFreshness({
			manifest: SAMPLE_MANIFEST,
			chainTip: 100_000,
		});
		expect(result.lag_blocks).toBe(0);
	});

	test("returns null lag when chain tip is unknown", () => {
		expect(
			streamsDumpsFreshness({ manifest: SAMPLE_MANIFEST, chainTip: null })
				.lag_blocks,
		).toBeNull();
	});
});

describe("streamsDumpsPublicBaseUrl + manifestUrl", () => {
	const previous = process.env.STREAMS_BULK_PUBLIC_BASE_URL;

	afterEach(() => {
		if (previous === undefined) {
			delete process.env.STREAMS_BULK_PUBLIC_BASE_URL;
		} else {
			process.env.STREAMS_BULK_PUBLIC_BASE_URL = previous;
		}
	});

	test("returns null when env var is unset", () => {
		delete process.env.STREAMS_BULK_PUBLIC_BASE_URL;
		expect(streamsDumpsPublicBaseUrl()).toBeNull();
		expect(streamsDumpsManifestUrl()).toBeNull();
	});

	test("strips trailing slashes and appends manifest path", () => {
		process.env.STREAMS_BULK_PUBLIC_BASE_URL =
			"https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev/stacks-streams/mainnet/v0/";
		expect(streamsDumpsPublicBaseUrl()).toBe(
			"https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev/stacks-streams/mainnet/v0",
		);
		expect(streamsDumpsManifestUrl()).toBe(
			"https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev/stacks-streams/mainnet/v0/manifest/latest.json",
		);
	});
});

describe("getStreamsBulkManifest", () => {
	const previousEnv = process.env.STREAMS_BULK_PUBLIC_BASE_URL;

	beforeEach(() => {
		resetStreamsDumpsManifestCache();
	});

	afterEach(() => {
		resetStreamsDumpsManifestCache();
		if (previousEnv === undefined) {
			delete process.env.STREAMS_BULK_PUBLIC_BASE_URL;
		} else {
			process.env.STREAMS_BULK_PUBLIC_BASE_URL = previousEnv;
		}
	});

	test("reports unavailable when STREAMS_BULK_PUBLIC_BASE_URL is unset", async () => {
		delete process.env.STREAMS_BULK_PUBLIC_BASE_URL;
		const snapshot = await getStreamsBulkManifest();
		expect(snapshot.status).toBe("unavailable");
		expect(snapshot.manifest).toBeNull();
	});
});
