import { describe, expect, test } from "bun:test";
import type {
	ContainerStatus,
	HealthStatus,
	SystemMetrics,
} from "../../types.ts";
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

function container(overrides: Partial<ContainerStatus>): ContainerStatus {
	return {
		name: "secondlayer-indexer-1",
		cpuPct: 1,
		memUsageMb: 100,
		memLimitMb: 1000,
		memPct: 10,
		restartCount: 0,
		running: true,
		health: "healthy",
		...overrides,
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

describe("detectAnomalies — container OOM and tenant parsing", () => {
	test("OOM-killed tenant processor emits critical alert-only oom_kill", () => {
		const currentMetrics = metrics(20);
		currentMetrics.containers = [
			container({
				name: "sl-proc-acme",
				oomKilled: true,
				restartCount: 4,
			}),
		];

		const matches = detectAnomalies({
			health: okHealth,
			metrics: currentMetrics,
		});
		const oom = matches.find((m) => m.name === "oom_kill");
		const oomIndex = matches.findIndex((m) => m.name === "oom_kill");
		const restartLoopIndex = matches.findIndex(
			(m) => m.name === "restart_loop",
		);

		expect(oom).toBeDefined();
		expect(oom?.severity).toBe("critical");
		expect(oom?.action).toBe("alert_only");
		expect(oom?.service).toBe("tenant:acme:processor");
		expect(oom?.message).toContain("sl-proc-acme");
		expect(oom?.message).toContain("acme");
		expect(oom?.message).toContain("processor");
		expect(oomIndex).toBeGreaterThanOrEqual(0);
		expect(restartLoopIndex).toBeGreaterThanOrEqual(0);
		expect(oomIndex).toBeLessThan(restartLoopIndex);
	});

	test("sl-proc slug parses as tenant processor", () => {
		const currentMetrics = metrics(20);
		currentMetrics.containers = [
			container({
				name: "sl-proc-acme",
				health: "unhealthy",
			}),
		];

		const matches = detectAnomalies({
			health: okHealth,
			metrics: currentMetrics,
		});
		const unhealthy = matches.find((m) => m.name === "tenant_unhealthy");

		expect(unhealthy).toBeDefined();
		expect(unhealthy?.service).toBe("tenant:acme:processor");
		expect(unhealthy?.message).toBe(
			"Tenant acme processor container is unhealthy",
		);
	});

	test("restart-loop still fires for non-OOM containers with restart count > 3", () => {
		const currentMetrics = metrics(20);
		currentMetrics.containers = [
			container({
				name: "secondlayer-api-1",
				restartCount: 4,
				oomKilled: false,
			}),
		];

		const matches = detectAnomalies({
			health: okHealth,
			metrics: currentMetrics,
		});

		expect(matches.filter((m) => m.name === "oom_kill")).toHaveLength(0);
		const restartLoop = matches.filter((m) => m.name === "restart_loop");
		expect(restartLoop).toHaveLength(1);
		expect(restartLoop[0].service).toBe("secondlayer-api-1");
	});
});
