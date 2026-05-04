import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusGridView } from "./status-grid-view";

describe("status page visual smoke", () => {
	test("renders public Streams and Index signals", () => {
		const html = renderToStaticMarkup(
			<StatusGridView
				incidentHeading="No active incidents"
				snapshot={{
					health: {
						state: "ok",
						label: "OK",
						description:
							"The API is reachable and ingest lag is under 60 seconds.",
					},
					tip: {
						block_height: 182447,
						burn_block_height: 871249,
						index_block_hash: "0x1234567890abcdef1234567890abcdef",
						lag_seconds: 3,
					},
					index: {
						status: "ok",
						decoders: [
							{
								decoder: "l2.ft_transfer.v1",
								eventType: "ft_transfer",
								status: "ok",
								lagSeconds: 12,
								checkpointBlockHeight: 182446,
								tipBlockHeight: 182447,
								lastDecodedAt: "2026-05-11T12:00:00.000Z",
							},
							{
								decoder: "l2.nft_transfer.v1",
								eventType: "nft_transfer",
								status: "degraded",
								lagSeconds: 60,
								checkpointBlockHeight: 182445,
								tipBlockHeight: 182447,
								lastDecodedAt: "2026-05-11T12:00:01.000Z",
							},
						],
					},
					api: {
						latency: { p50_ms: 24, p95_ms: 91 },
						error_rate: 0.0025,
						requests: 400,
						errors_5xx: 1,
						window_seconds: 300,
						groups: {},
					},
					node: { status: "ok" },
					services: [
						{ name: "api", status: "ok" },
						{ name: "database", status: "ok" },
						{ name: "indexer", status: "ok" },
						{ name: "l2_decoder", status: "degraded" },
					],
					reorgs: { last_24h: null },
					lastChecked: new Date("2026-05-03T20:30:45Z"),
					error: null,
				}}
			/>,
		);

		expect(html).toContain("API health");
		expect(html).toContain("Current chain tip");
		expect(html).toContain("API telemetry");
		expect(html).toContain("Stacks Index freshness");
		expect(html).toContain("Node and services");
		expect(html).toContain("FT 12s");
		expect(html).toContain("NFT 1m");
		expect(html).toContain("24ms");
		expect(html).toContain("91ms");
		expect(html).toContain("0.25%");
		expect(html).toContain("Stacks node");
		expect(html).toContain("Reorgs last 24h");
		expect(html).toContain("Incident note");
		expect(html).toContain("No active incidents");
		expect(html).toContain("182,447");
		expect(html).toContain("0x12345678...abcdef");
	});
});
