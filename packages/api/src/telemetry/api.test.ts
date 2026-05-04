import { describe, expect, test, beforeEach } from "bun:test";
import {
	classifyApiTelemetryPath,
	getApiTelemetrySnapshot,
	recordApiTelemetrySample,
	resetApiTelemetryForTests,
} from "./api.ts";

describe("API telemetry", () => {
	beforeEach(() => resetApiTelemetryForTests());

	test("classifies public product and status paths", () => {
		expect(classifyApiTelemetryPath("/v1/streams/events")).toBe("streams");
		expect(classifyApiTelemetryPath("/v1/index/ft-transfers")).toBe("index");
		expect(classifyApiTelemetryPath("/public/status")).toBe("status");
		expect(classifyApiTelemetryPath("/status")).toBe("status");
		expect(classifyApiTelemetryPath("/api/accounts")).toBe("platform");
	});

	test("reports aggregate and per-group p50, p95, and 5xx error rate", () => {
		const now = Date.parse("2026-05-11T12:00:00.000Z");
		for (const durationMs of [10, 20, 30, 100]) {
			recordApiTelemetrySample({
				group: "streams",
				durationMs,
				status: 200,
				now,
			});
		}
		recordApiTelemetrySample({
			group: "index",
			durationMs: 200,
			status: 503,
			now,
		});

		const snapshot = getApiTelemetrySnapshot(now);
		expect(snapshot.latency.p50_ms).toBe(30);
		expect(snapshot.latency.p95_ms).toBe(200);
		expect(snapshot.error_rate).toBe(0.2);
		expect(snapshot.groups.streams.latency.p50_ms).toBe(20);
		expect(snapshot.groups.streams.latency.p95_ms).toBe(100);
		expect(snapshot.groups.streams.error_rate).toBe(0);
		expect(snapshot.groups.index.error_rate).toBe(1);
		expect(snapshot.window_seconds).toBe(300);
	});

	test("drops samples outside the rolling five minute window", () => {
		const now = Date.parse("2026-05-11T12:00:00.000Z");
		recordApiTelemetrySample({
			group: "status",
			durationMs: 500,
			status: 500,
			now: now - 301_000,
		});
		recordApiTelemetrySample({
			group: "status",
			durationMs: 25,
			status: 200,
			now,
		});

		const snapshot = getApiTelemetrySnapshot(now);
		expect(snapshot.groups.status.requests).toBe(1);
		expect(snapshot.groups.status.latency.p50_ms).toBe(25);
		expect(snapshot.groups.status.error_rate).toBe(0);
	});
});
