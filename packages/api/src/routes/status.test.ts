import { describe, expect, test } from "bun:test";
import {
	type DecodersHealth,
	getEnabledDecoderNames,
} from "@secondlayer/indexer/decode/health";
import type { StreamsTip } from "../streams/tip.ts";
import {
	NODE_LAG_DEGRADED_SECONDS,
	nodeStatusFromStreamsTip,
	publicIndexStatusFromL2Health,
	subgraphProcessorVerdict,
} from "./status.ts";

// publicIndexStatusFromL2Health surfaces every enabled decoder, defaulting any
// the L2 health snapshot omits to "unavailable". The fixtures below only carry
// health for the always-on ft + nft pair, so the rest report unavailable.
const ENABLED_COUNT = getEnabledDecoderNames().length;
import {
	getApiTelemetrySnapshot,
	recordApiTelemetrySample,
	resetApiTelemetryForTests,
} from "../telemetry/api.ts";

const HEALTHY_INDEX: DecodersHealth = {
	status: "healthy",
	decoders: [
		{
			status: "healthy",
			decoder: "decode.ft_transfer.v1",
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
			decoder: "decode.nft_transfer.v1",
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
	test("maps FT and NFT decoder health into the public shape", () => {
		const status = publicIndexStatusFromL2Health(HEALTHY_INDEX);

		// Every enabled decoder is surfaced; the two with health are "ok", the
		// rest default to "unavailable" → overall degraded.
		expect(status.decoders).toHaveLength(ENABLED_COUNT);
		expect(status.status).toBe("degraded");

		const byDecoder = new Map(status.decoders.map((d) => [d.decoder, d]));
		expect(byDecoder.get("decode.ft_transfer.v1")).toEqual({
			decoder: "decode.ft_transfer.v1",
			eventType: "ft_transfer",
			status: "ok",
			lagSeconds: 12,
			checkpointBlockHeight: 100,
			tipBlockHeight: 101,
			lastDecodedAt: "2026-05-11T12:00:00.000Z",
		});
		expect(byDecoder.get("decode.nft_transfer.v1")).toEqual({
			decoder: "decode.nft_transfer.v1",
			eventType: "nft_transfer",
			status: "ok",
			lagSeconds: 18,
			checkpointBlockHeight: 99,
			tipBlockHeight: 101,
			lastDecodedAt: "2026-05-11T12:00:01.000Z",
		});

		// Decoders absent from the health snapshot default to unavailable.
		const others = status.decoders.filter(
			(d) =>
				d.decoder !== "decode.ft_transfer.v1" &&
				d.decoder !== "decode.nft_transfer.v1",
		);
		expect(others.every((d) => d.status === "unavailable")).toBe(true);
	});

	test("marks unhealthy decoders as degraded", () => {
		const [ftDecoder] = HEALTHY_INDEX.decoders;
		const status = publicIndexStatusFromL2Health({
			...HEALTHY_INDEX,
			status: "unhealthy",
			decoders: [{ ...ftDecoder, status: "unhealthy" }],
		});

		expect(status.status).toBe("degraded");
		const byDecoder = new Map(status.decoders.map((d) => [d.decoder, d]));
		expect(byDecoder.get("decode.ft_transfer.v1")?.status).toBe("degraded");
		expect(
			status.decoders
				.filter((d) => d.decoder !== "decode.ft_transfer.v1")
				.every((d) => d.status === "unavailable"),
		).toBe(true);
	});

	test("falls back to unavailable when L2 health cannot be read", () => {
		const status = publicIndexStatusFromL2Health(null);

		expect(status.status).toBe("unavailable");
		expect(status.decoders).toHaveLength(ENABLED_COUNT);
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

describe("/status subgraph processor verdict", () => {
	// The 2026-07-30 outage: a three-block canonical gap wedged every subgraph
	// for hours. The loop kept ticking and heartbeating, so a liveness-only
	// check reported `ok` the entire time while the plane fell 5,500 blocks
	// behind. Progress is a separate question and has to be asked separately.
	test("a fresh heartbeat with no progress is degraded, not ok", () => {
		expect(
			subgraphProcessorVerdict({ ageSeconds: 5, blocksBehind: 5_540 }),
		).toEqual({ status: "degraded", reason: "stalled" });
	});

	test("keeping up is ok", () => {
		expect(
			subgraphProcessorVerdict({ ageSeconds: 5, blocksBehind: 3 }),
		).toEqual({ status: "ok", reason: "fresh" });
	});

	test("a stale heartbeat is degraded even when progress looks fine", () => {
		expect(
			subgraphProcessorVerdict({ ageSeconds: 600, blocksBehind: 0 }),
		).toEqual({ status: "degraded", reason: "stale" });
	});

	test("unknown progress does not manufacture a failure", () => {
		// No active subgraphs, or no tip — absence of evidence isn't evidence.
		expect(
			subgraphProcessorVerdict({ ageSeconds: 5, blocksBehind: null }),
		).toEqual({ status: "ok", reason: "fresh" });
	});
});

describe("/status node status", () => {
	const tipAt = (lag_seconds: number) => ({ lag_seconds }) as StreamsTip;

	// The threshold was 60s, inside normal block-spacing variance. Sampled
	// against prod, tip lag sawtooths ~15s→~130s between blocks, so the node
	// surface reported degraded ~18% of the time and — because the status page
	// takes the worst surface — dragged the whole page to "Some systems
	// degraded" while everything was fine. These lags must all read ok.
	test("routine block-spacing lag is ok, not degraded", () => {
		for (const lag of [0, 45, 60, 65, 100, 131, 179]) {
			expect(nodeStatusFromStreamsTip(tipAt(lag))).toBe("ok");
		}
	});

	test("degrades at the shared threshold, not before", () => {
		expect(nodeStatusFromStreamsTip(tipAt(NODE_LAG_DEGRADED_SECONDS - 1))).toBe(
			"ok",
		);
		expect(nodeStatusFromStreamsTip(tipAt(NODE_LAG_DEGRADED_SECONDS))).toBe(
			"degraded",
		);
		expect(nodeStatusFromStreamsTip(tipAt(600))).toBe("degraded");
	});

	// Matches LAG_DEGRADED_SECONDS in apps/web/src/lib/status-page.ts; the two
	// judge the same surface and drifting apart is what caused the flapping.
	test("uses the same threshold the web surfaces use", () => {
		expect(NODE_LAG_DEGRADED_SECONDS).toBe(180);
	});

	test("no tip is unavailable, not degraded", () => {
		// We could not observe the node — that is not a confirmed problem.
		expect(nodeStatusFromStreamsTip(null)).toBe("unavailable");
	});
});
