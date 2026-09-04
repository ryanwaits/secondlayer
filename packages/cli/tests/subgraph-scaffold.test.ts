import { describe, expect, test } from "bun:test";
import {
	SIP009_ABI,
	SIP010_ABI,
	normalizeAbi,
} from "@secondlayer/stacks/clarity";
import type { AbiContract } from "@secondlayer/stacks/clarity";
import { generateSubgraphScaffold } from "../src/generators/subgraph-scaffold.ts";

const CID = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.usda-token";

describe("standard-aware scaffolder", () => {
	test("SIP-010 → ft_transfer source + transfers table + working handler", async () => {
		const out = await generateSubgraphScaffold({
			contractId: CID,
			abi: SIP010_ABI,
		});
		expect(out).toContain("ft_transfer");
		expect(out).toContain(`${CID}::token`); // asset id from fungible_tokens[0].name
		expect(out).toContain("ctx.insert("); // real handler, not TODO
		expect(out).not.toContain("TODO");
		expect(out).toContain("amount: event.amount");
	});

	test("SIP-009 → nft_transfer source", async () => {
		const out = await generateSubgraphScaffold({
			contractId: "SP2.my-nft",
			abi: SIP009_ABI,
		});
		expect(out).toContain("nft_transfer");
		expect(out).toContain("token_id: String(event.tokenId)");
	});

	test("non-token → single generic calls table", async () => {
		const abi: AbiContract = {
			functions: [
				{ name: "do-thing", access: "public", args: [], outputs: "bool" },
			],
		};
		const out = await generateSubgraphScaffold({ contractId: "SP2.dao", abi });
		expect(out).toContain("contract_call");
		expect(out).toContain("function_name: event.functionName");
	});

	test("--trait → trait-scoped source, no contract", async () => {
		const out = await generateSubgraphScaffold({ trait: "sip-010" });
		expect(out).toContain("ft_transfer");
		expect(out).toContain("sip-010");
		expect(out).not.toContain("contractId"); // no fixed contract
	});

	test("asset id survives the fetched-ABI path, which goes through normalizeAbi", async () => {
		// `subgraphs scaffold <contract-id>` fetches a raw ABI and normalizes it.
		// A bare contract id here is not a valid asset identifier and matches
		// zero rows, so the `::asset` suffix has to survive normalization.
		const raw = {
			functions: SIP010_ABI.functions,
			fungible_tokens: [{ name: "token" }],
		};
		const out = await generateSubgraphScaffold({
			contractId: CID,
			abi: normalizeAbi(raw),
		});

		expect(out).toContain(`${CID}::token`);
	});

	test("--functions → typed table per named function", async () => {
		const out = await generateSubgraphScaffold({
			contractId: CID,
			abi: SIP010_ABI,
			functions: ["transfer"],
		});
		expect(out).toContain("functionName");
		// The source carries the `as const` ABI, so handlers read NAMED, typed
		// args — no positional index and no unchecked cast.
		expect(out).toContain("as const");
		expect(out).toContain("abi,");
		expect(out).toContain("event.input.amount");
		expect(out).toContain("event.input.recipient");
		expect(out).not.toContain("event.args[");
		expect(out).not.toContain("as bigint");
	});
});
