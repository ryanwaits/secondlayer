import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusMinimalView } from "./status-minimal-view";

describe("status page visual smoke", () => {
	test("renders the high-level surface verdict + metrics", () => {
		const html = renderToStaticMarkup(
			<StatusMinimalView
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
						block_hash: "0x1234567890abcdef1234567890abcdef",
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
								lagSeconds: 200,
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
					lastChecked: new Date("2026-05-03T20:30:45Z"),
					error: null,
				}}
			/>,
		);

		// One Index decoder is degraded → the overall verdict degrades.
		expect(html).toContain("Some systems degraded.");
		expect(html).toContain("Degraded");
		// Metrics strip from real fields.
		expect(html).toContain("#182,447");
		expect(html).toContain("24ms");
		expect(html).toContain("0.25%");
		// All six surface pills are present.
		expect(html).toContain("Index");
		expect(html).toContain("Subgraphs");
		expect(html).toContain("Streams");
		expect(html).toContain("Webhooks");
		expect(html).toContain("Stacks node");
		// Incident line is derived live: a degraded verdict → active-incident copy.
		expect(html).toContain("Investigating an active incident");
	});
});
