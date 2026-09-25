import { describe, expect, test } from "bun:test";
import { extractSubgraphDefinition } from "@secondlayer/bundler";
import { sourcesNeedingAbi, withDerivedAbis } from "../src/lib/derive-abi.ts";

const SOURCE = `
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
	name: "stakes",
	sources: {
		stake: { type: "contract_call", contractId: "SP1.pool", functionName: "stake" },
		unstake: { type: "contract_call", contractId: "SP1.pool", functionName: "unstake" },
		any: { type: "contract_call", contractId: "SP1.pool-*", functionName: "swap" },
		calls: { type: "contract_call", contractId: "SP1.pool" },
	},
	schema: { rows: { columns: { amount: { type: "uint" } } } },
	handlers: {
		stake: (event, ctx) => ctx.insert("rows", { amount: 1n }),
		unstake: (event, ctx) => ctx.insert("rows", { amount: 1n }),
		any: (event, ctx) => ctx.insert("rows", { amount: 1n }),
		calls: (event, ctx) => ctx.insert("rows", { amount: 1n }),
	},
});
`;

const HIRO_ABI = {
	functions: [
		{ name: "stake", access: "public", args: [], outputs: { type: "bool" } },
	],
	variables: [],
	maps: [],
	fungible_tokens: [],
	non_fungible_tokens: [],
};

describe("sourcesNeedingAbi", () => {
	test("only single-contract functionName sources without abi", () => {
		const sources = extractSubgraphDefinition(SOURCE).sources;
		expect(sourcesNeedingAbi(sources)).toEqual([
			{ name: "stake", contractId: "SP1.pool" },
			{ name: "unstake", contractId: "SP1.pool" },
		]);
	});
});

describe("withDerivedAbis", () => {
	test("fetches each contract once and writes the normalized abi into the source", async () => {
		const fetched: string[] = [];
		const client = {
			getContractInfo: async (id: string) => {
				fetched.push(id);
				return HIRO_ABI as never;
			},
		};
		const { source, abis } = await withDerivedAbis(SOURCE, client);
		expect(fetched).toEqual(["SP1.pool"]);
		expect(Object.keys(abis)).toEqual(["stake", "unstake"]);
		const sources = extractSubgraphDefinition(source).sources as Record<
			string,
			{ abi?: { functions: Array<{ name: string }> } }
		>;
		expect(sources.stake?.abi?.functions[0]?.name).toBe("stake");
		expect(sources.any?.abi).toBeUndefined();
	});

	test("a failed fetch names the source and says how to pass abi", async () => {
		const client = {
			getContractInfo: async () => {
				throw new Error("Contract not found: SP1.pool");
			},
		};
		await expect(withDerivedAbis(SOURCE, client)).rejects.toThrow(
			/source "stake" \(SP1.pool\).*Pass abi on the source/,
		);
	});

	test("nothing to derive leaves the source unchanged", async () => {
		const plain = SOURCE.replace(/functionName: "[a-z]+"/g, 'caller: "SP2"');
		const { source, abis } = await withDerivedAbis(plain, {
			getContractInfo: async () => {
				throw new Error("should not fetch");
			},
		});
		expect(source).toBe(plain);
		expect(abis).toEqual({});
	});
});
