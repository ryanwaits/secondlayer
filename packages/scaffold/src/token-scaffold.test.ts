import { describe, expect, test } from "bun:test";
import { SIP009_ABI, SIP010_ABI } from "@secondlayer/stacks/clarity";
import type { AbiContract } from "@secondlayer/stacks/clarity";
import {
	generateTokenSubgraph,
	generateTokenSubgraphFromAbi,
} from "./token-scaffold.ts";

const CID = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.usda-token";

describe("generateTokenSubgraph", () => {
	test("ft_transfer with text asset_identifier", () => {
		const out = generateTokenSubgraph({
			name: "usda",
			type: "ft_transfer",
			assetIdentifier: `${CID}::token`,
		});
		expect(out).toContain("ft_transfer");
		expect(out).toContain(`${CID}::token`);
		expect(out).toContain("asset_identifier: { type: 'text'");
		expect(out).toContain("ctx.insert(");
	});
});

describe("generateTokenSubgraphFromAbi", () => {
	test("SIP-010 → ft_transfer", () => {
		const out = generateTokenSubgraphFromAbi({
			contractId: CID,
			abi: SIP010_ABI,
		});
		expect(out).toContain("ft_transfer");
		expect(out).toContain(`${CID}::token`);
	});

	test("SIP-009 → nft_transfer", () => {
		const out = generateTokenSubgraphFromAbi({
			contractId: "SP2.my-nft",
			abi: SIP009_ABI,
		});
		expect(out).toContain("nft_transfer");
		expect(out).toContain("token_id: String(event.tokenId)");
	});

	test("non-token → null", () => {
		const abi: AbiContract = {
			functions: [
				{ name: "do-thing", access: "public", args: [], outputs: "bool" },
			],
		};
		expect(
			generateTokenSubgraphFromAbi({ contractId: "SP2.dao", abi }),
		).toBeNull();
	});
});
