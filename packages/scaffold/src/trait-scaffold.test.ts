import { describe, expect, test } from "bun:test";
import { generateTraitSubgraph } from "./trait-scaffold.ts";

describe("generateTraitSubgraph", () => {
	test("sip-010 → ft_transfer source scoped by trait", () => {
		const out = generateTraitSubgraph({ trait: "sip-010" });
		expect(out).toContain("defineSubgraph(");
		expect(out).toContain("name: 'sip-010-transfers'");
		expect(out).toContain("type: 'ft_transfer'");
		expect(out).toContain("trait: 'sip-010'");
		expect(out).toContain("amount: event.amount");
		expect(out).not.toContain("assetIdentifier: '"); // no fixed contract/asset
	});

	test("sip-009 → nft_transfer source with token_id", () => {
		const out = generateTraitSubgraph({ trait: "sip-009" });
		expect(out).toContain("type: 'nft_transfer'");
		expect(out).toContain("trait: 'sip-009'");
		expect(out).toContain("token_id: String(event.tokenId)");
	});

	test("name override", () => {
		const out = generateTraitSubgraph({ trait: "sip-013", name: "sfts" });
		expect(out).toContain("name: 'sfts'");
		expect(out).toContain("trait: 'sip-013'");
	});
});
