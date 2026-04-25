import { describe, expect, test } from "bun:test";
import type { HealthStatus, SystemMetrics } from "../../types.ts";
import { detectAnomalies } from "../health-poller.ts";

const okHealth: HealthStatus = {
	indexer: { ok: true, lastSeenHeight: 1000 },
	api: { ok: true },
	stacksNode: { ok: true, tipHeight: 1000, burnHeight: 900 },
	integrity: { ok: true, totalMissing: 0 },
};

function metrics(diskPct: number): SystemMetrics {
	return {
		diskUsedPct: diskPct,
		diskAvailBytes: 100_000_000_000,
		memUsedPct: 50,
		memAvailBytes: 1_000_000_000,
		containers: [],
		timestamp: Date.now(),
	};
}

describe("detectAnomalies — disk hysteresis", () => {
	test("single poll above 85% but below 95% does NOT alert", () => {
		const matches = detectAnomalies({
			health: okHealth,
			metrics: metrics(87),
		});
		expect(matches.filter((m) => m.name === "disk_high")).toHaveLength(0);
	});

	test("two consecutive polls above 85% DOES alert warn", () => {
		const matches = detectAnomalies(
			{ health: okHealth, metrics: metrics(87) },
			{ health: okHealth, metrics: metrics(86) },
		);
		const disk = matches.filter((m) => m.name === "disk_high");
		expect(disk).toHaveLength(1);
		expect(disk[0].severity).toBe("warn");
		expect(disk[0].action).toBe("prune_docker");
	});

	test("previous below 85%, current above → NO alert (flap guard)", () => {
		const matches = detectAnomalies(
			{ health: okHealth, metrics: metrics(87) },
			{ health: okHealth, metrics: metrics(70) },
		);
		expect(matches.filter((m) => m.name === "disk_high")).toHaveLength(0);
	});

	test("single poll above 95% DOES alert critical immediately (no hysteresis)", () => {
		const matches = detectAnomalies({
			health: okHealth,
			metrics: metrics(96),
		});
		const disk = matches.filter((m) => m.name === "disk_high");
		expect(disk).toHaveLength(1);
		expect(disk[0].severity).toBe("critical");
	});

	test("exactly 85% does not trigger (strict > threshold)", () => {
		const matches = detectAnomalies(
			{ health: okHealth, metrics: metrics(85) },
			{ health: okHealth, metrics: metrics(85) },
		);
		expect(matches.filter((m) => m.name === "disk_high")).toHaveLength(0);
	});
});
