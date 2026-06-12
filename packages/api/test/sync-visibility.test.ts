import { describe, expect, test } from "bun:test";
import { buildSyncInfo } from "../src/routes/subgraphs.ts";

const LIVE = {
	status: "reindexing",
	start_block: 1,
	last_processed_block: 5000,
};
const NO_GAPS = { count: 0, totalMissingBlocks: 0, ranges: [] };

describe("buildSyncInfo queue/ETA fields", () => {
	test("queued op surfaces position, denominator, and est start", () => {
		const sync = buildSyncInfo(LIVE, 10_000, NO_GAPS, "complete", {
			status: "queued",
			estimatedEvents: 38_000,
			processedEvents: null,
			startedAt: null,
			queuePosition: 3,
			medianDurationSeconds: 240,
		}) as {
			queue?: {
				position: number;
				estimatedEvents: number;
				estimatedStartSeconds: number;
			};
		};
		expect(sync.queue).toEqual({
			position: 3,
			estimatedEvents: 38_000,
			estimatedStartSeconds: 720,
		});
	});

	test("running op computes event ETA from rate after 30s", () => {
		const sync = buildSyncInfo(LIVE, 10_000, NO_GAPS, "complete", {
			status: "running",
			estimatedEvents: 10_000,
			processedEvents: 2_500,
			startedAt: new Date(Date.now() - 100_000), // 25 events/s
			queuePosition: null,
		}) as {
			estimatedEvents?: number;
			processedEvents?: number;
			etaSeconds?: number | null;
		};
		expect(sync.estimatedEvents).toBe(10_000);
		expect(sync.processedEvents).toBe(2_500);
		expect(sync.etaSeconds).toBe(300); // 7500 remaining / 25 per s
	});

	test("running op under 30s elapsed gives null ETA (no rate signal yet)", () => {
		const sync = buildSyncInfo(LIVE, 10_000, NO_GAPS, "complete", {
			status: "running",
			estimatedEvents: 10_000,
			processedEvents: 50,
			startedAt: new Date(Date.now() - 5_000),
			queuePosition: null,
		}) as { etaSeconds?: number | null };
		expect(sync.etaSeconds).toBeNull();
	});

	test("no opInfo leaves the shape unchanged (no queue/eta keys)", () => {
		const sync = buildSyncInfo(LIVE, 10_000, NO_GAPS, "complete") as Record<
			string,
			unknown
		>;
		expect("queue" in sync).toBe(false);
		expect("etaSeconds" in sync).toBe(false);
	});
});
