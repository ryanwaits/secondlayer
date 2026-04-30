import { describe, expect, test } from "bun:test";
import { resolveCatchupBatchConfig } from "./catchup.ts";

describe("catch-up batch config", () => {
	test("hobby plan resolves low-memory batch bounds and disables prefetch", () => {
		expect(resolveCatchupBatchConfig({ TENANT_PLAN: "hobby" })).toEqual({
			defaultBatchSize: 50,
			minBatchSize: 25,
			maxBatchSize: 100,
			prefetch: false,
		});
	});

	test("non-hobby and default plans preserve larger batch bounds and prefetch", () => {
		expect(resolveCatchupBatchConfig({ TENANT_PLAN: "launch" })).toEqual({
			defaultBatchSize: 500,
			minBatchSize: 100,
			maxBatchSize: 1000,
			prefetch: true,
		});
		expect(resolveCatchupBatchConfig({})).toEqual({
			defaultBatchSize: 500,
			minBatchSize: 100,
			maxBatchSize: 1000,
			prefetch: true,
		});
	});

	test("env override clamps default batch size to resolved bounds", () => {
		expect(
			resolveCatchupBatchConfig({
				TENANT_PLAN: "hobby",
				SUBGRAPH_CATCHUP_BATCH_SIZE: "500",
				SUBGRAPH_CATCHUP_MIN_BATCH_SIZE: "10",
				SUBGRAPH_CATCHUP_MAX_BATCH_SIZE: "80",
			}),
		).toEqual({
			defaultBatchSize: 80,
			minBatchSize: 10,
			maxBatchSize: 80,
			prefetch: false,
		});
	});

	test("invalid and empty env overrides fall back to plan defaults", () => {
		expect(
			resolveCatchupBatchConfig({
				TENANT_PLAN: "hobby",
				SUBGRAPH_CATCHUP_BATCH_SIZE: "wat",
				SUBGRAPH_CATCHUP_MIN_BATCH_SIZE: "",
				SUBGRAPH_CATCHUP_MAX_BATCH_SIZE: "-1",
				SUBGRAPH_CATCHUP_PREFETCH: "nope",
			}),
		).toEqual({
			defaultBatchSize: 50,
			minBatchSize: 25,
			maxBatchSize: 100,
			prefetch: false,
		});
	});

	test("explicit prefetch false disables prefetch for non-hobby", () => {
		expect(
			resolveCatchupBatchConfig({
				TENANT_PLAN: "launch",
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
