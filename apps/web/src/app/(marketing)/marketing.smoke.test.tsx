import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BnsDatasetContent } from "./datasets/bns/page";
import { NetworkHealthDatasetContent } from "./datasets/network-health/page";
import { DatasetsContent, datasets } from "./datasets/page";
import { Pox4DatasetContent } from "./datasets/pox-4/page";
import { SbtcDatasetContent } from "./datasets/sbtc/page";
import { StxTransfersDatasetContent } from "./datasets/stx-transfers/page";
import { HomeStatusBadge, homeProducts } from "./page";
import { QuickstartContent } from "./quickstart/page";
import { StacksIndexContent } from "./stacks-index/page";
import { StacksStreamsContent } from "./stacks-streams/page";
import { SubgraphQueryShapeNote, SubgraphRouteList } from "./subgraphs/page";
import { WritingsPostContent } from "./writings/[slug]/page";
import { WritingsIndexContent } from "./writings/page";
import { writings } from "./writings/posts";

describe("marketing routes", () => {
	test("home renders Streams, Index, and freshness badge", () => {
		const html = renderToStaticMarkup(
			<HomeStatusBadge
				status={{
					status: "healthy",
					chainTip: 182447,
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
								status: "ok",
								lagSeconds: 18,
								checkpointBlockHeight: 182446,
								tipBlockHeight: 182447,
								lastDecodedAt: "2026-05-11T12:00:01.000Z",
							},
						],
					},
					recentDeliveries: 0,
					timestamp: "2026-05-11T12:00:02.000Z",
				}}
			/>,
		);
		const productNames = homeProducts.map((product) => product.name);

		expect(productNames).toContain("Stacks Streams");
		expect(productNames).toContain("Stacks Index");
		expect(productNames).toContain("Stacks Datasets");
		expect(productNames).toContain("CLI");
		expect(productNames).toContain("SDK");
		expect(productNames).toContain("MCP");
		expect(productNames).toContain("Stacks");
		expect(html).toContain("Block");
		expect(html).toContain("#182,447");
		expect(html).toContain("FT 12s");
		expect(html).toContain("NFT 18s");
		expect(html).toContain("home-status-dot");
	});

	test("/writings renders yearly groups", () => {
		const html = renderToStaticMarkup(<WritingsIndexContent />);
		expect(html).toContain("Writings");
		const years = new Set(writings.map((p) => String(p.year)));
		for (const year of years) {
			expect(html).toContain(year);
		}
		for (const post of writings) {
			expect(html).toContain(post.title);
			expect(html).toContain(`/writings/${post.slug}`);
		}
	});

	test("/writings/[slug] renders the welcome post", () => {
		const post = writings.find((p) => p.slug === "welcome");
		if (!post) throw new Error("welcome post fixture missing");
		const html = renderToStaticMarkup(<WritingsPostContent post={post} />);
		expect(html).toContain(post.title);
		expect(html).toContain(post.date);
		expect(html).toContain("Writings section");
	});

	test("/stacks-streams renders key docs copy", () => {
		const html = renderToStaticMarkup(<StacksStreamsContent />);

		expect(html).toContain("L1 read surface");
		expect(html).toContain("custom indexers");
		expect(html).toContain("streams:read");
		expect(html).toContain("/v1/streams/events");
		expect(html).toContain("/v1/streams/tip");
		expect(html).toContain("/v1/streams/canonical/");
		expect(html).toContain("sl.streams.canonical");
		expect(html).toContain("sl.streams.events.byTxId");
		expect(html).toContain("sl.streams.blocks.events");
		expect(html).toContain("sl.streams.reorgs.list");
		expect(html).toContain("reorgs: []");
		expect(html).toContain("is required");
	});

	test("/stacks-index renders key docs copy", () => {
		const html = renderToStaticMarkup(<StacksIndexContent />);

		expect(html).toContain("L2 read surface");
		expect(html).toContain("index:read");
		expect(html).toContain("/v1/index/ft-transfers");
		expect(html).toContain("/v1/index/nft-transfers");
		expect(html).toContain("sl.index.ftTransfers.list");
		expect(html).toContain("sl.index.nftTransfers.list");
		expect(html).toContain("raw Clarity-serialized");
		expect(html).toContain("reorgs: []");
		expect(html).toContain("populated only when");
	});

	test("/quickstart renders 5-min onboarding path", () => {
		const html = renderToStaticMarkup(<QuickstartContent />);
		expect(html).toContain("Quickstart");
		expect(html).toContain("30 seconds");
		expect(html).toContain("api.secondlayer.tools/v1/datasets/sbtc/events");
		expect(html).toContain("/v1/datasets/stx-transfers");
		expect(html).toContain("/v1/datasets/pox-4/calls");
		expect(html).toContain("/v1/datasets/bns/resolve");
		expect(html).toContain("/v1/datasets/network-health/summary");
		// language snippets
		expect(html).toContain("await fetch(");
		expect(html).toContain("import requests");
		expect(html).toContain("http.Get");
		// CLI escalation
		expect(html).toContain("bun add -g @secondlayer/cli");
		expect(html).toContain("sl subgraphs new");
		expect(html).toContain("sip-010-balances");
		// interactive sandbox renders on /quickstart
		expect(html).toContain("dataset-sandbox");
		expect(html).toContain("Try it live");
	});

	test("/datasets lists the five-dataset shelf", () => {
		const html = renderToStaticMarkup(<DatasetsContent />);
		expect(html).toContain("Stacks Datasets");
		expect(html).toContain("STX Transfers");
		expect(html).toContain("PoX-4");
		expect(html).toContain("sBTC");
		expect(html).toContain("BNS");
		expect(html).toContain("Network Health");
		expect(datasets.find((d) => d.slug === "stx-transfers")?.status).toBe(
			"shipped",
		);
		expect(datasets.find((d) => d.slug === "pox-4")?.status).toBe("shipped");
		expect(datasets.find((d) => d.slug === "bns")?.status).toBe("shipped");
	});

	test("/datasets/stx-transfers renders schema + API + parquet docs", () => {
		const html = renderToStaticMarkup(<StxTransfersDatasetContent />);
		expect(html).toContain("STX Transfers");
		expect(html).toContain("/v1/datasets/stx-transfers");
		expect(html).toContain("stacks-datasets/mainnet/v0/stx-transfers");
		expect(html).toContain("microSTX");
		expect(html).toContain("manifest/latest.json");
	});

	test("/datasets/network-health renders summary endpoint", () => {
		const html = renderToStaticMarkup(<NetworkHealthDatasetContent />);
		expect(html).toContain("Network Health");
		expect(html).toContain("/v1/datasets/network-health/summary");
		expect(html).toContain("avg_block_time_seconds");
		expect(html).toContain("reorg_count");
	});

	test("/datasets/bns renders source + 3 event tables + resolver", () => {
		const html = renderToStaticMarkup(<BnsDatasetContent />);
		expect(html).toContain("BNS");
		expect(html).toContain("/v1/datasets/bns/name-events");
		expect(html).toContain("BNS-V2");
		expect(html).toContain("bns_name_events");
		expect(html).toContain("bns_namespace_events");
		expect(html).toContain("bns_marketplace_events");
		expect(html).toContain("bns_names");
		expect(html).toContain("bns_namespaces");
		expect(html).toContain("alice.btc");
		expect(html).toContain("transfer-name");
		// sandbox embedded
		expect(html).toContain("dataset-sandbox");
		expect(html).toContain("Try bns/name-events");
		expect(html).toContain("Try bns/resolve");
	});

	test("/datasets/pox-4 renders source + tables + API", () => {
		const html = renderToStaticMarkup(<Pox4DatasetContent />);
		expect(html).toContain("PoX-4");
		expect(html).toContain("/v1/datasets/pox-4/calls");
		expect(html).toContain("SP000000000000000000002Q6VF78.pox-4");
		expect(html).toContain("stack-stx");
		expect(html).toContain("delegate-stx");
		expect(html).toContain("stack-aggregation-commit");
		expect(html).toContain("set-signer-key-authorization");
		expect(html).toContain("pox4_calls");
		// sandbox embedded
		expect(html).toContain("dataset-sandbox");
		expect(html).toContain("Try pox-4/calls");
	});

	test("/datasets/sbtc renders schema + topics + API + parquet", () => {
		const html = renderToStaticMarkup(<SbtcDatasetContent />);
		expect(html).toContain("sBTC");
		expect(html).toContain("/v1/datasets/sbtc/events");
		expect(html).toContain("/v1/datasets/sbtc/token-events");
		expect(html).toContain("completed-deposit");
		expect(html).toContain("withdrawal-create");
		expect(html).toContain("sbtc-registry");
		expect(html).toContain("stacks-datasets/mainnet/v0/sbtc/events");
		expect(html).toContain("stacks-datasets/mainnet/v0/sbtc/token-events");
		expect(html).toContain("manifest/latest.json");
		// sandbox embedded
		expect(html).toContain("dataset-sandbox");
		expect(html).toContain("Try sbtc/events");
		expect(html).toContain("Try sbtc/token-events");
	});

	test("/subgraphs renders L3 route docs copy", () => {
		const html = renderToStaticMarkup(
			<>
				<SubgraphQueryShapeNote />
				<SubgraphRouteList />
			</>,
		);

		expect(html).toContain("L3 surface");
		expect(html).toContain("{ data, meta }");
		expect(html).toContain("{ count }");
		expect(html).toContain("/api/subgraphs");
		expect(html).toContain("/api/subgraphs/:name");
		expect(html).toContain("/api/subgraphs/:name/source");
		expect(html).toContain("/api/subgraphs/:name/gaps");
		expect(html).toContain("/api/subgraphs/:name/openapi.json");
		expect(html).toContain("/api/subgraphs/:name/schema.json");
		expect(html).toContain("/api/subgraphs/:name/docs.md");
		expect(html).toContain("/api/subgraphs/:name/:table");
		expect(html).toContain("/api/subgraphs/:name/:table/count");
		expect(html).toContain("/api/subgraphs/:name/:table/:id");
	});
});
