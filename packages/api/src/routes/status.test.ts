import { describe, expect, test } from "bun:test";
import type { L2DecodersHealth } from "@secondlayer/indexer/l2/health";
import { publicIndexStatusFromL2Health } from "./status.ts";
import {
	getApiTelemetrySnapshot,
	recordApiTelemetrySample,
	resetApiTelemetryForTests,
} from "../telemetry/api.ts";

const HEALTHY_INDEX: L2DecodersHealth = {
	status: "healthy",
	decoders: [
		{
			status: "healthy",
			decoder: "l2.ft_transfer.v1",
			checkpoint: "100:2",
			checkpoint_block_height: 100,
			tip_block_height: 101,
			lag_seconds: 12,
			last_decoded_at: "2026-05-11T12:00:00.000Z",
			writes_recent: true,
			checkpoint_recent: true,
		},
		{
			status: "healthy",
			decoder: "l2.nft_transfer.v1",
			checkpoint: "99:4",
			checkpoint_block_height: 99,
			tip_block_height: 101,
			lag_seconds: 18,
			last_decoded_at: "2026-05-11T12:00:01.000Z",
			writes_recent: true,
			checkpoint_recent: true,
		},
	],
};

describe("/status Index freshness", () => {
	test("returns FT and NFT decoder status in public shape", () => {
		expect(publicIndexStatusFromL2Health(HEALTHY_INDEX)).toEqual({
			status: "ok",
			decoders: [
				{
					decoder: "l2.ft_transfer.v1",
					eventType: "ft_transfer",
					status: "ok",
					lagSeconds: 12,
					checkpointBlockHeight: 100,
					tipBlockHeight: 101,
					lastDecodedAt: "2026-05-11T12:00:00.000Z",
				},
				{
					decoder: "l2.nft_transfer.v1",
					eventType: "nft_transfer",
					status: "ok",
					lagSeconds: 18,
					checkpointBlockHeight: 99,
					tipBlockHeight: 101,
					lastDecodedAt: "2026-05-11T12:00:01.000Z",
				},
			],
		});
	});

	test("marks unhealthy decoders as degraded", () => {
		const [ftDecoder] = HEALTHY_INDEX.decoders;
		const status = publicIndexStatusFromL2Health({
			...HEALTHY_INDEX,
			status: "unhealthy",
			decoders: [{ ...ftDecoder, status: "unhealthy" }],
		});

		expect(status.status).toBe("degraded");
		expect(status.decoders.map((decoder) => decoder.status)).toEqual([
			"degraded",
			"unavailable",
		]);
	});

	test("falls back to unavailable when L2 health cannot be read", () => {
		const status = publicIndexStatusFromL2Health(null);

		expect(status.status).toBe("unavailable");
		expect(status.decoders).toHaveLength(2);
		expect(
			status.decoders.every((decoder) => decoder.status === "unavailable"),
		).toBe(true);
	});
});

describe("/status API telemetry shape", () => {
	test("exposes public p50, p95, and error rate names", () => {
		resetApiTelemetryForTests();
		recordApiTelemetrySample({
			group: "streams",
			durationMs: 42,
			status: 200,
			now: 1_000,
		});

		const api = getApiTelemetrySnapshot(1_000);
		expect(api.latency.p50_ms).toBe(42);
		expect(api.latency.p95_ms).toBe(42);
		expect(api.error_rate).toBe(0);
		expect(api.groups.streams.requests).toBe(1);
		expect(api.groups.index.requests).toBe(0);
	});
});
