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
		expect(out).toContain("asset_identifier: { type: 'text'");
		expect(out).not.toContain("asset_identifier: { type: 'principal'");
		expect(out).not.toContain("assetIdentifier: '"); // no fixed contract/asset
	});

	test("sip-009 → nft_transfer source with token_id", () => {
		const out = generateTraitSubgraph({ trait: "sip-009" });
		expect(out).toContain("type: 'nft_transfer'");
		expect(out).toContain("trait: 'sip-009'");
		expect(out).toContain("token_id: String(event.tokenId)");
		expect(out).toContain("asset_identifier: { type: 'text'");
	});

	test("name override", () => {
		const out = generateTraitSubgraph({ trait: "sip-013", name: "sfts" });
		expect(out).toContain("name: 'sfts'");
		expect(out).toContain("trait: 'sip-013'");
	});

	test("balances → increment + uniqueKeys, no ctx: any", () => {
		const out = generateTraitSubgraph({ trait: "sip-010", balances: true });
		expect(out).toContain("name: 'sip-010-balances'");
		expect(out).toContain("type: 'ft_transfer'");
		expect(out).toContain("type: 'ft_mint'");
		expect(out).toContain("type: 'ft_burn'");
		expect(out).toContain("uniqueKeys: [['asset_identifier', 'holder']]");
		expect(out).toContain("ctx.increment(");
		expect(out).not.toContain("ctx: any");
		expect(out).not.toContain("findOne");
		expect(out).not.toContain("upsert");
	});

	test("balances rejected for sip-009", () => {
		expect(() =>
			generateTraitSubgraph({ trait: "sip-009", balances: true }),
		).toThrow(/FT traits/);
	});
});
