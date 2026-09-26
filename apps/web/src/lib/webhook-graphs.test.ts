import { describe, expect, test } from "bun:test";
import type { DeliveryRow } from "@secondlayer/sdk";
import { type WebhookDetail, buildDoctorReport } from "@secondlayer/sdk";
import {
	activityHeaderSummary,
	catchUpCopy,
	catchUpState,
	deliveryLagSeries,
	rateLimitedShareByHour,
	responseTimeHistogram,
	ribbonCells,
} from "./webhook-graphs";

function row(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
	return {
		id: crypto.randomUUID(),
		attempt: 1,
		statusCode: 200,
		errorMessage: null,
		durationMs: 100,
		responseBody: null,
		dispatchedAt: "2026-04-23T00:00:00.000Z",
		blockTime: null,
		...overrides,
	};
}

describe("ribbonCells", () => {
	test("an empty window is 0 of 0 ok", () => {
		const result = ribbonCells([]);
		expect(result.cells).toEqual([]);
		expect(result.summary).toBe("0 of 0 ok");
	});

	test("all 2xx is N of N ok", () => {
		const rows = [row({ statusCode: 200 }), row({ statusCode: 201 })];
		expect(ribbonCells(rows).summary).toBe("2 of 2 ok");
	});

	test("mixed outcomes drop zero-valued parts", () => {
		const rows = [
			row({ statusCode: 200 }),
			row({ statusCode: 200 }),
			row({ statusCode: 500 }),
		];
		expect(ribbonCells(rows).summary).toBe("2 ok · 1 failed");
	});

	test("429s count as rate-limited, not failed", () => {
		const rows = [row({ statusCode: 429 }), row({ statusCode: 500 })];
		expect(ribbonCells(rows).summary).toBe("0 ok · 1 failed · 1 rate-limited");
	});

	test("cells are oldest to newest, reversing the newest-first input", () => {
		const rows = [
			row({ statusCode: 500, durationMs: 50 }), // newest
			row({ statusCode: 200, durationMs: 10 }), // oldest
		];
		const { cells } = ribbonCells(rows);
		expect(cells[0]?.status).toBe("ok");
		expect(cells[0]?.label).toBe("attempt 1 · 200 · 10 ms");
		expect(cells[1]?.status).toBe("failed");
		expect(cells[1]?.label).toBe("attempt 2 · 500 · 50 ms");
	});

	test("no response labels without a status code or duration", () => {
		const rows = [row({ statusCode: null, durationMs: null })];
		expect(ribbonCells(rows).cells[0]?.label).toBe("attempt 1 · no response");
	});
});

describe("activityHeaderSummary", () => {
	function hour(overrides: {
		delivered?: number;
		waiting?: number;
		gaveUp?: number;
	}) {
		return {
			hour: "2026-04-23T00:00:00.000Z",
			delivered: 0,
			waiting: 0,
			gaveUp: 0,
			...overrides,
		};
	}

	test("an empty window is 0 events delivered", () => {
		expect(activityHeaderSummary([])).toBe("0 events delivered");
	});

	test("drops waiting and gave-up when both are zero", () => {
		expect(activityHeaderSummary([hour({ delivered: 1204 })])).toBe(
			"1,204 events delivered",
		);
	});

	test("shows waiting and gave-up only when non-zero, summed across hours", () => {
		const hours = [
			hour({ delivered: 100, waiting: 5 }),
			hour({ delivered: 50, gaveUp: 2 }),
		];
		expect(activityHeaderSummary(hours)).toBe(
			"150 events delivered · 5 waiting · 2 gave up",
		);
	});
});

describe("rateLimitedShareByHour", () => {
	test("an empty window returns no buckets", () => {
		expect(rateLimitedShareByHour([])).toEqual([]);
	});

	test("buckets by dispatch hour and computes the 429 share", () => {
		const rows = [
			row({ dispatchedAt: "2026-04-23T10:15:00.000Z", statusCode: 429 }),
			row({ dispatchedAt: "2026-04-23T10:45:00.000Z", statusCode: 200 }),
			row({ dispatchedAt: "2026-04-23T11:05:00.000Z", statusCode: 429 }),
		];
		const buckets = rateLimitedShareByHour(rows);
		expect(buckets).toEqual([
			{
				hour: "2026-04-23T10:00:00.000Z",
				total: 2,
				count429: 1,
				sharePct: 50,
			},
			{
				hour: "2026-04-23T11:00:00.000Z",
				total: 1,
				count429: 1,
				sharePct: 100,
			},
		]);
	});
});

describe("responseTimeHistogram", () => {
	test("an empty window has a zero median and empty bins", () => {
		const result = responseTimeHistogram([], 10_000);
		expect(result.median).toBe(0);
		expect(result.sampleCount).toBe(0);
		expect(result.bins).toHaveLength(20);
		expect(result.bins.every((b) => b.count === 0)).toBe(true);
	});

	test("bins durations across the timeout range and matches the doctor's median", () => {
		const durations = [500, 1000, 9000, 9200, 9500];
		const rows = durations.map((durationMs) => row({ durationMs }));
		const result = responseTimeHistogram(rows, 10_000);
		expect(result.sampleCount).toBe(5);
		expect(result.median).toBe(9000);

		const webhook = { timeoutMs: 10_000 } as WebhookDetail;
		const report = buildDoctorReport({
			webhook,
			deliveries: rows,
			dead: [],
			subgraph: null,
		});
		const evidence = report.issues
			.find((i) => i.code === "receiver_slow")
			?.evidence?.find((e) => e.label === "median response time")?.value;
		expect(evidence).toBe("9.0s");
		expect(result.median).toBe(9000);
	});

	test("only the newest 20 attempts count, matching receiver_slow's window", () => {
		const old = Array.from({ length: 30 }, () => row({ durationMs: 1 }));
		const recent = [row({ durationMs: 9999 })];
		const result = responseTimeHistogram([...recent, ...old], 10_000);
		expect(result.sampleCount).toBe(20);
		expect(result.bins[19]?.count).toBe(1);
	});

	test("null durations are skipped, not treated as zero", () => {
		const rows = [row({ durationMs: null }), row({ durationMs: 200 })];
		const result = responseTimeHistogram(rows, 10_000);
		expect(result.sampleCount).toBe(1);
		expect(result.median).toBe(200);
	});
});

describe("deliveryLagSeries", () => {
	test("an empty window returns no points", () => {
		expect(deliveryLagSeries([])).toEqual([]);
	});

	test("rows without a block time are skipped", () => {
		const rows = [
			row({ blockTime: null }),
			row({
				dispatchedAt: "2026-04-23T00:01:00.000Z",
				blockTime: "2026-04-23T00:00:00.000Z",
			}),
		];
		const points = deliveryLagSeries(rows);
		expect(points).toHaveLength(1);
		expect(points[0]?.lagMs).toBe(60_000);
	});

	test("points come back oldest to newest", () => {
		const rows = [
			row({
				dispatchedAt: "2026-04-23T00:02:00.000Z",
				blockTime: "2026-04-23T00:00:00.000Z",
			}),
			row({
				dispatchedAt: "2026-04-23T00:01:00.000Z",
				blockTime: "2026-04-23T00:00:00.000Z",
			}),
		];
		const points = deliveryLagSeries(rows);
		expect(points[0]?.dispatchedAt).toBe("2026-04-23T00:01:00.000Z");
		expect(points[1]?.dispatchedAt).toBe("2026-04-23T00:02:00.000Z");
	});

	test("only the newest 40 events with a block time are kept", () => {
		const rows = Array.from({ length: 45 }, (_, i) =>
			row({
				dispatchedAt: `2026-04-23T00:${String(i).padStart(2, "0")}:00.000Z`,
				blockTime: "2026-04-23T00:00:00.000Z",
			}),
		);
		expect(deliveryLagSeries(rows)).toHaveLength(40);
	});
});

describe("catchUpState and catchUpCopy", () => {
	test("no polls yet: zero rate, no ETA, copy shows events left only", () => {
		const state = catchUpState(1000, 1000, []);
		expect(state.ratePerMin).toBe(0);
		expect(state.etaMinutes).toBeNull();
		expect(catchUpCopy(state)).toBe("1,000 events left.");
	});

	test("a steady drain rate produces an ETA and the full copy line", () => {
		const history = [
			{ t: 0, waiting: 5100 },
			{ t: 60_000, waiting: 4690 },
			{ t: 120_000, waiting: 4280 },
		];
		const state = catchUpState(5100, 4280, history);
		expect(state.ratePerMin).toBe(410);
		expect(state.etaMinutes).toBe(Math.ceil(4280 / 410));
		expect(state.progress).toBeCloseTo((5100 - 4280) / 5100);
		expect(catchUpCopy(state)).toBe(
			`4,280 events left, about ${state.etaMinutes} min at 410 a minute. 820 of 5,100 sent so far, oldest first.`,
		);
	});

	test("a queue that grew between polls clamps the rate to zero, not negative", () => {
		const history = [
			{ t: 0, waiting: 100 },
			{ t: 60_000, waiting: 150 },
		];
		const state = catchUpState(150, 150, history);
		expect(state.ratePerMin).toBe(0);
		expect(state.etaMinutes).toBeNull();
	});

	test("peak of 0 never divides by zero", () => {
		const state = catchUpState(0, 0, []);
		expect(state.progress).toBe(0);
		expect(state.sentSoFar).toBe(0);
	});
});
