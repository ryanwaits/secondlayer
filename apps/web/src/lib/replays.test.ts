import { describe, expect, test } from "bun:test";
import type { ReplayProgress } from "@secondlayer/shared/schemas/webhooks";
import {
	estimateLine,
	minutesLeft,
	replayPercent,
	runningReplayFor,
} from "./replays";

function progress(patch: Partial<ReplayProgress>): ReplayProgress {
	return {
		replayId: "0123456789abcdef",
		webhookId: "wh_1",
		status: "running",
		fromBlock: 100,
		toBlock: 200,
		total: 3812,
		processed: 0,
		pending: 3812,
		delivered: null,
		gaveUp: null,
		startedAt: "2026-10-18T10:00:00.000Z",
		finishedAt: null,
		error: null,
		...patch,
	};
}

describe("replayPercent", () => {
	test("is 0 when nothing was enqueued", () => {
		expect(replayPercent(progress({ total: 0, pending: 0 }))).toBe(0);
	});
	test("floors processed over total", () => {
		expect(replayPercent(progress({ processed: 1452 }))).toBe(38);
	});
	test("is 100 when everything settled", () => {
		expect(replayPercent(progress({ processed: 3812, pending: 0 }))).toBe(100);
	});
});

describe("minutesLeft", () => {
	test("is null with one sample", () => {
		expect(minutesLeft([{ at: 0, settled: 0 }], 3000)).toBeNull();
	});
	test("is null when the samples are under 2 s apart", () => {
		expect(
			minutesLeft(
				[
					{ at: 0, settled: 0 },
					{ at: 1500, settled: 50 },
				],
				3000,
			),
		).toBeNull();
	});
	test("is null when nothing moved", () => {
		expect(
			minutesLeft(
				[
					{ at: 0, settled: 10 },
					{ at: 5000, settled: 10 },
				],
				3000,
			),
		).toBeNull();
	});
	test("300 settled in 60 s with 3,000 left is 10 minutes", () => {
		expect(
			minutesLeft(
				[
					{ at: 0, settled: 0 },
					{ at: 60_000, settled: 300 },
				],
				3300,
			),
		).toBe(10);
	});
	test("never drops below 1", () => {
		expect(
			minutesLeft(
				[
					{ at: 0, settled: 0 },
					{ at: 60_000, settled: 300 },
				],
				301,
			),
		).toBe(1);
	});
});

describe("estimateLine", () => {
	test("rounds the cost to cents", () => {
		expect(estimateLine(3812, false)).toBe("About 3,812 events · $0.04");
	});
	test("says at least for a lower bound", () => {
		expect(estimateLine(84210, true)).toBe("At least 84,210 events · $0.84");
	});
	test("says under a cent below a cent", () => {
		expect(estimateLine(12, false)).toBe("About 12 events · under $0.01");
	});
});

describe("runningReplayFor", () => {
	test("finds the newest scanning or running replay of one webhook", () => {
		const older = progress({
			replayId: "old",
			startedAt: "2026-10-18T09:00:00.000Z",
		});
		const newer = progress({
			replayId: "new",
			startedAt: "2026-10-18T10:00:00.000Z",
			status: "scanning",
		});
		const other = progress({ replayId: "x", webhookId: "wh_2" });
		const done = progress({ replayId: "d", status: "done" });
		expect(
			runningReplayFor([older, newer, other, done], "wh_1")?.replayId,
		).toBe("new");
	});
	test("is null with nothing running or before the first read", () => {
		expect(runningReplayFor([progress({ status: "done" })], "wh_1")).toBeNull();
		expect(runningReplayFor(null, "wh_1")).toBeNull();
	});
});
