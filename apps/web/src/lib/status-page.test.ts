import { describe, expect, test } from "bun:test";
import {
	determineApiHealth,
	determinePublicStatusHealth,
	formatLag,
	formatErrorRate,
	formatLastChecked,
	formatLatencyMs,
	indexFreshnessColor,
	indexFreshnessLabel,
	readIncidentHeading,
	serviceDisplayName,
	serviceStatusColor,
	truncateHash,
} from "./status-page";

describe("status page helpers", () => {
	test("marks tip responses under 60 seconds as OK", () => {
		expect(determineApiHealth({ ok: true, tip: { lag_seconds: 12 } })).toEqual({
			state: "ok",
			label: "OK",
			description: "The API is reachable and ingest lag is under 60 seconds.",
		});
	});

	test("marks tip responses at or above 60 seconds as degraded", () => {
		expect(
			determineApiHealth({ ok: true, tip: { lag_seconds: 60 } }).state,
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
		expect(serviceDisplayName("l2_decoder")).toBe("L2 decoder");
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
					decoder: "l2.ft_transfer.v1",
					eventType: "ft_transfer" as const,
					status: "ok" as const,
					lagSeconds: 12,
					checkpointBlockHeight: 100,
					tipBlockHeight: 101,
					lastDecodedAt: "2026-05-11T12:00:00.000Z",
				},
				{
					decoder: "l2.nft_transfer.v1",
					eventType: "nft_transfer" as const,
					status: "degraded" as const,
					lagSeconds: 60,
					checkpointBlockHeight: 99,
					tipBlockHeight: 101,
					lastDecodedAt: "2026-05-11T12:00:01.000Z",
				},
			],
		};

		expect(indexFreshnessLabel("ft_transfer", index)).toBe("FT 12s");
		expect(indexFreshnessLabel("nft_transfer", index)).toBe("NFT 1m");
		expect(indexFreshnessColor(index.decoders[0])).toBe("green");
		expect(indexFreshnessColor(index.decoders[1])).toBe("yellow");
		expect(indexFreshnessLabel("ft_transfer", null)).toBe("FT unavailable");
		expect(indexFreshnessColor(null)).toBe("muted");
	});
});
