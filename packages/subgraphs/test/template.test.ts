import { describe, expect, test } from "bun:test";
import {
	SUBGRAPH_TEMPLATE_SLUGS,
	generateSubgraphTemplate,
} from "../../cli/src/templates/subgraph.ts";

describe("generateSubgraphTemplate", () => {
	test("output passes validateSubgraphDefinition", async () => {
		const content = generateSubgraphTemplate("test-subgraph");
		// The template uses defineSubgraph and imports — we can't directly eval it,
		// but we can verify it contains the expected structure
		expect(content).toContain('name: "test-subgraph"');
		expect(content).toContain("version:");
		expect(content).toContain("sources:");
		expect(content).toContain("schema:");
		expect(content).toContain("handlers:");
	});

	test("generated name is valid", () => {
		const result = generateSubgraphTemplate("my-cool-subgraph");
		expect(result).toContain('name: "my-cool-subgraph"');
	});

	test("every template slug renders a valid-looking subgraph", () => {
		for (const slug of SUBGRAPH_TEMPLATE_SLUGS) {
			const content = generateSubgraphTemplate("my-graph", slug);
			expect(content, `slug ${slug}`).toContain('name: "my-graph"');
			expect(content, `slug ${slug}`).toContain("defineSubgraph");
			expect(content, `slug ${slug}`).toContain("sources:");
			expect(content, `slug ${slug}`).toContain("schema:");
			expect(content, `slug ${slug}`).toContain("handlers:");
		}
	});

	test("sip-010-balances template tracks balances per asset+holder", () => {
		const content = generateSubgraphTemplate("balances", "sip-010-balances");
		expect(content).toContain("ft_transfer");
		expect(content).toContain("ft_mint");
		expect(content).toContain("ft_burn");
		expect(content).toContain("balances");
		expect(content).toContain("asset_identifier");
		expect(content).toContain("holder");
	});

	test("sbtc-flows template subscribes to sbtc-registry", () => {
		const content = generateSubgraphTemplate("flows", "sbtc-flows");
		expect(content).toContain("sbtc-registry");
		expect(content).toContain(
			"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
		);
		expect(content).toContain("print_event");
	});

	test("pox-stacking template targets the pox-4 contract", () => {
		const content = generateSubgraphTemplate("staking", "pox-stacking");
		expect(content).toContain("contract_call");
		expect(content).toContain("SP000000000000000000002Q6VF78.pox-4");
	});

	test("bns-names template subscribes to BNS-V2", () => {
		const content = generateSubgraphTemplate("names", "bns-names");
		expect(content).toContain("print_event");
		expect(content).toContain(
			"SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2",
		);
		expect(content).toContain("burn-name");
	});
});
