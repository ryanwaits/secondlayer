import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeStatusBadge, homeProducts } from "./page";
import { StacksIndexContent } from "./stacks-index/page";

describe("marketing routes", () => {
	test("home renders Stacks Index and freshness badge", () => {
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

		expect(homeProducts.map((product) => product.name)).toContain(
			"Stacks Index",
		);
		expect(html).toContain("Block");
		expect(html).toContain("#182,447");
		expect(html).toContain("FT 12s");
		expect(html).toContain("NFT 18s");
	});

	test("/stacks-index renders key docs copy", () => {
		const html = renderToStaticMarkup(<StacksIndexContent />);

		expect(html).toContain("index:read");
		expect(html).toContain("/v1/index/ft-transfers");
		expect(html).toContain("/v1/index/nft-transfers");
		expect(html).toContain("raw Clarity-serialized");
		expect(html).toContain("reorgs: []");
	});
});
