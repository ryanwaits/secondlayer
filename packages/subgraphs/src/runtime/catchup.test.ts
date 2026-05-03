import { describe, expect, test } from "bun:test";
import { resolveCatchupBatchConfig } from "./catchup.ts";

describe("catch-up batch config", () => {
	test("plans use standard batch bounds and prefetch", () => {
		expect(resolveCatchupBatchConfig({})).toEqual({
			defaultBatchSize: 500,
			minBatchSize: 100,
			maxBatchSize: 1000,
			prefetch: true,
		});
		expect(resolveCatchupBatchConfig()).toEqual({
			defaultBatchSize: 500,
			minBatchSize: 100,
			maxBatchSize: 1000,
			prefetch: true,
		});
	});

	test("env override clamps default batch size to resolved bounds", () => {
		expect(
			resolveCatchupBatchConfig({
				SUBGRAPH_CATCHUP_BATCH_SIZE: "500",
				SUBGRAPH_CATCHUP_MIN_BATCH_SIZE: "10",
				SUBGRAPH_CATCHUP_MAX_BATCH_SIZE: "80",
			}),
		).toEqual({
			defaultBatchSize: 80,
			minBatchSize: 10,
			maxBatchSize: 80,
			prefetch: true,
		});
	});

	test("invalid and empty env overrides fall back to defaults", () => {
		expect(
			resolveCatchupBatchConfig({
				SUBGRAPH_CATCHUP_BATCH_SIZE: "wat",
				SUBGRAPH_CATCHUP_MIN_BATCH_SIZE: "",
				SUBGRAPH_CATCHUP_MAX_BATCH_SIZE: "-1",
				SUBGRAPH_CATCHUP_PREFETCH: "nope",
			}),
		).toEqual({
			defaultBatchSize: 500,
			minBatchSize: 100,
			maxBatchSize: 1000,
			prefetch: true,
		});
	});

	test("explicit prefetch false disables prefetch", () => {
		expect(
			resolveCatchupBatchConfig({
				SUBGRAPH_CATCHUP_PREFETCH: "false",
			}),
		).toEqual({
			defaultBatchSize: 500,
			minBatchSize: 100,
			maxBatchSize: 1000,
			prefetch: false,
		});
	});
});
