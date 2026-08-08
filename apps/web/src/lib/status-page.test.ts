import { describe, expect, test } from "bun:test";
import {
	type StatusSnapshot,
	deriveSurfaces,
	determineApiHealth,
	determinePublicStatusHealth,
	formatErrorRate,
	formatLag,
	formatLastChecked,
	formatLatencyMs,
	indexFreshnessColor,
	indexFreshnessLabel,
	overallStatus,
	readIncidentHeading,
	serviceDisplayName,
	serviceStatusColor,
	truncateHash,
} from "./status-page";

describe("status page helpers", () => {
	test("marks tip responses under the degraded threshold as OK", () => {
		expect(determineApiHealth({ ok: true, tip: { lag_seconds: 12 } })).toEqual({
			state: "ok",
			label: "OK",
			description: "The API is reachable and ingest lag is under 180s.",
		});
	});

	test("marks tip responses at or above the degraded threshold as degraded", () => {
		expect(
			determineApiHealth({ ok: true, tip: { lag_seconds: 180 } }).state,
		).toBe("degraded");
	});

	test("marks failed tip requests as down", () => {
		expect(determineApiHealth({ ok: false, status: 500 }).state).toBe("down");
	});

	test("derives public status health from the aggregate public contract", () => {
		expect(determinePublicStatusHealth(null).state).toBe("down");
		expect(
			determinePublicStatusHealth({
				status: "healthy",
				chainTip: 1,
				timestamp: "2026-05-03T20:30:45Z",
				recentDeliveries: 0,
			}).state,
		).toBe("ok");
		expect(
			determinePublicStatusHealth({
				status: "degraded",
				chainTip: 1,
				timestamp: "2026-05-03T20:30:45Z",
				recentDeliveries: 0,
			}).state,
		).toBe("degraded");
	});

	test("formats lag for seconds, minutes, and hours", () => {
		expect(formatLag(4)).toBe("4s");
		expect(formatLag(65)).toBe("1m 5s");
		expect(formatLag(7200)).toBe("2h");
		expect(formatLag(undefined)).toBe("Unknown");
	});

	test("formats last-checked timestamp in UTC", () => {
		expect(formatLastChecked(new Date("2026-05-03T20:30:45.123Z"))).toBe(
			"2026-05-03 20:30:45 UTC",
		);
		expect(formatLastChecked(null)).toBe("Not checked yet");
	});

	test("truncates long block hashes", () => {
		expect(truncateHash("0x1234567890abcdef1234567890abcdef")).toBe(
			"0x12345678...abcdef",
		);
	});

	test("formats telemetry and service health labels", () => {
		expect(formatLatencyMs(24.4)).toBe("24ms");
		expect(formatLatencyMs(null)).toBe("Unknown");
		expect(formatErrorRate(0.0125)).toBe("1.25%");
		expect(serviceStatusColor("ok")).toBe("green");
		expect(serviceStatusColor("degraded")).toBe("yellow");
		expect(serviceStatusColor("unavailable")).toBe("muted");
		expect(serviceDisplayName("decoder")).toBe("Decoder");
	});

	test("reads the incident heading from markdown", () => {
		expect(readIncidentHeading("## No active incidents\n")).toBe(
			"No active incidents",
		);
	});

	test("formats Index freshness labels and colors", () => {
		const index = {
			status: "degraded" as const,
			decoders: [
				{
					decoder: "decode.ft_transfer.v1",
					eventType: "ft_transfer" as const,
					status: "ok" as const,
					lagSeconds: 12,
					checkpointBlockHeight: 100,
					tipBlockHeight: 101,
					lastDecodedAt: "2026-05-11T12:00:00.000Z",
				},
				{
					decoder: "decode.nft_transfer.v1",
					eventType: "nft_transfer" as const,
					status: "degraded" as const,
					lagSeconds: 180,
					checkpointBlockHeight: 99,
					tipBlockHeight: 101,
					lastDecodedAt: "2026-05-11T12:00:01.000Z",
				},
			],
		};

		expect(indexFreshnessLabel("ft_transfer", index)).toBe("FT 12s");
		expect(indexFreshnessLabel("nft_transfer", index)).toBe("NFT 3m");
		expect(indexFreshnessColor(index.decoders[0])).toBe("green");
		expect(indexFreshnessColor(index.decoders[1])).toBe("yellow");
		expect(indexFreshnessLabel("ft_transfer", null)).toBe("FT unavailable");
		expect(indexFreshnessColor(null)).toBe("muted");
	});
});

describe("node surface", () => {
	// The status page reduces to the WORST surface, so a single flapping surface
	// takes the whole headline with it. `node.status` is computed API-side and
	// arrives as a string, so this is the only place the behaviour is visible.
	function snapshot(node: StatusSnapshot["node"]): StatusSnapshot {
		return {
			health: { state: "ok", label: "OK", description: "" },
			tip: { lag_seconds: 30 } as StatusSnapshot["tip"],
			index: {
				status: "ok",
				decoders: [
					{
						decoder: "decode.ft_transfer.v1",
						eventType: "ft_transfer",
						status: "ok",
						lagSeconds: 30,
						checkpointBlockHeight: 100,
						tipBlockHeight: 101,
						lastDecodedAt: "2026-05-11T12:00:00.000Z",
					},
				],
			} as StatusSnapshot["index"],
			api: null,
			node,
			services: [
				{ name: "subgraph_processor", status: "ok" },
			] as StatusSnapshot["services"],
			lastChecked: null,
			error: null,
		};
	}

	function surfaceState(node: StatusSnapshot["node"]) {
		const snap = snapshot(node);
		const surfaces = deriveSurfaces(snap);
		return {
			node: surfaces.find((s) => s.key === "node")?.state,
			pill: overallStatus(snap, surfaces).pill,
		};
	}

	test("a healthy node leaves the page operational", () => {
		expect(surfaceState({ status: "ok" })).toEqual({
			node: "ok",
			pill: "Operational",
		});
	});

	// Guards the regression this test file was extended for: while the API
	// degraded the node at 60s tip lag, routine block spacing pushed roughly one
	// in five page loads to "Degraded" with every other surface ok.
	test("a degraded node drags the whole page to degraded", () => {
		expect(surfaceState({ status: "degraded" })).toEqual({
			node: "degraded",
			pill: "Degraded",
		});
	});

	test("an unobservable node is unknown, not a confirmed outage", () => {
		expect(surfaceState({ status: "unavailable" })).toEqual({
			node: "unknown",
			pill: "Operational",
		});
		expect(surfaceState(null)).toEqual({
			node: "unknown",
			pill: "Operational",
		});
	});
});
