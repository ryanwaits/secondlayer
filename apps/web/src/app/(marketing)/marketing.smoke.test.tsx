import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeStatusBadge, homeProducts } from "./page";
import { StacksIndexContent } from "./stacks-index/page";
import { StacksStreamsContent } from "./stacks-streams/page";
import { SubgraphQueryShapeNote, SubgraphRouteList } from "./subgraphs/page";

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
		expect(html).toContain("Block");
		expect(html).toContain("#182,447");
		expect(html).toContain("FT 12s");
		expect(html).toContain("NFT 18s");
		expect(html).toContain("home-status-dot");
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
