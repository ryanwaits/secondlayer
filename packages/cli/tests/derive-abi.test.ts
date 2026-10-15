import { describe, expect, test } from "bun:test";
import { extractSubgraphDefinition } from "@secondlayer/bundler";
import {
	sourcesNamingState,
	sourcesNeedingAbi,
	withDerivedAbis,
} from "../src/lib/derive-abi.ts";

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

function stateSource(sources: string): string {
	return `
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
	name: "vault",
	sources: { ${sources} },
	schema: { rows: { columns: { amount: { type: "uint" } } } },
	handlers: {},
});
`;
}

const VAULT_ABI = {
	...HIRO_ABI,
	variables: [{ name: "fee", type: "uint128", access: "variable" }],
	maps: [{ name: "reserve", key: "principal", value: "uint128" }],
};

describe("state source names", () => {
	test("a map_set source naming a map the contract lacks fails with the contract's maps", async () => {
		const src = stateSource(
			'writes: { type: "map_set", contractId: "SP1.vault", map: "reserves" }',
		);
		const client = { getContractInfo: async () => VAULT_ABI as never };
		const err = await withDerivedAbis(src, client).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toContain('map "reserves"');
		expect(err.message).toContain("Its maps: reserve.");
	});

	test("a var_set source naming a missing variable fails with the contract's variables", async () => {
		const src = stateSource(
			'fee: { type: "var_set", contractId: "SP1.vault", varName: "fees" }',
		);
		const client = { getContractInfo: async () => VAULT_ABI as never };
		const err = await withDerivedAbis(src, client).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toContain('variable "fees"');
		expect(err.message).toContain("Its variables: fee.");
	});

	test("a correct map name deploys and fetches the contract once", async () => {
		const src = stateSource(
			`stake: { type: "contract_call", contractId: "SP1.vault", functionName: "stake" },
			writes: { type: "map_set", contractId: "SP1.vault", map: "reserve" }`,
		);
		const fetched: string[] = [];
		const client = {
			getContractInfo: async (id: string) => {
				fetched.push(id);
				return VAULT_ABI as never;
			},
		};
		const { abis } = await withDerivedAbis(src, client);
		expect(fetched).toEqual(["SP1.vault"]);
		expect(Object.keys(abis)).toEqual(["stake"]);
	});

	test("state sources with a wildcard, trait or no name are not checked", async () => {
		const src = stateSource(
			`wild: { type: "map_set", contractId: "SP1.vault-*", map: "nope" },
			traited: { type: "var_set", trait: { functions: [] }, varName: "nope" },
			unnamed: { type: "map_delete", contractId: "SP1.vault" }`,
		);
		const sources = extractSubgraphDefinition(src).sources;
		expect(sourcesNamingState(sources)).toEqual([]);
		const { abis } = await withDerivedAbis(src, {
			getContractInfo: async () => {
				throw new Error("should not fetch");
			},
		});
		expect(abis).toEqual({});
	});

	test("an unreachable contract interface does not block a state-only source", async () => {
		const src = stateSource(
			'writes: { type: "map_set", contractId: "SP1.vault", map: "reserves" }',
		);
		const { source } = await withDerivedAbis(src, {
			getContractInfo: async () => {
				throw new Error("offline");
			},
		});
		expect(source).toBe(src);
	});
});
