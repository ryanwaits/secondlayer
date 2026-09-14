import { describe, expect, it } from "bun:test";
import { generateContractInterface } from "../src/generators/contract";
import type { ResolvedContract } from "../src/types/config";

describe("Maps, Variables, and Constants Generation", () => {
	const contractWithState: ResolvedContract = {
		name: "tokenContract",
		address: "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9",
		contractName: "token-contract",
		abi: {
			functions: [
				{
					name: "transfer",
					access: "public",
					args: [
						{ name: "amount", type: "uint128" },
						{ name: "recipient", type: "principal" },
					],
					outputs: { response: { ok: "bool", error: "uint128" } },
				},
				{
					name: "get-balance",
					access: "read-only",
					args: [{ name: "account", type: "principal" }],
					outputs: "uint128",
				},
			],
			maps: [
				{
					name: "balances",
					key: "principal",
					value: "uint128",
				},
				{
					name: "allowances",
					key: {
						tuple: [
							{ name: "owner", type: "principal" },
							{ name: "spender", type: "principal" },
						],
					},
					value: "uint128",
				},
			],
			variables: [
				{
					name: "total-supply",
					type: "uint128",
					access: "variable",
				},
				{
					name: "token-name",
					type: { "string-ascii": { length: 32 } },
					access: "constant",
				},
				{
					name: "token-decimals",
					type: "uint128",
					access: "constant",
				},
				{
					name: "contract-owner",
					type: "principal",
					access: "variable",
				},
			],
		},
		source: "api",
	};

	describe("Contract Generator - Maps", () => {
		it("should generate maps object with typed get methods", async () => {
			const code = await generateContractInterface([contractWithState]);

			// Should have maps object
			expect(code).toContain("maps: {");
			expect(code).toContain("balances: {");
			expect(code).toContain("allowances: {");

			// Should have get method with key parameter
			expect(code).toContain("key: string");

			// Configurable override (apiUrl + env) layered over the network default
			expect(code).toContain("apiUrl?:");
			expect(code).toContain("network?:");
			expect(code).toContain("STACKS_NODE_RPC_URL");
		});

		it("should generate proper tuple key types for maps", async () => {
			const code = await generateContractInterface([contractWithState]);

			// Allowances map has tuple key
			expect(code).toContain("owner: string");
			expect(code).toContain("spender: string");
		});

		it("should generate API call for map entry", async () => {
			const code = await generateContractInterface([contractWithState]);

			// Should use Hiro API endpoint for map entries
			expect(code).toContain("/v2/map_entry/");
			expect(code).toContain("POST");
		});
	});

	describe("Contract Generator - Variables", () => {
		it("should generate vars object for data variables", async () => {
			const code = await generateContractInterface([contractWithState]);

			// Should have vars object
			expect(code).toContain("vars: {");
			expect(code).toContain("totalSupply: {");
			expect(code).toContain("contractOwner: {");
		});

		it("should generate get method for variables", async () => {
			const code = await generateContractInterface([contractWithState]);

			// Should have get method
			expect(code).toContain("async get(");
			// Should use data_var endpoint
			expect(code).toContain("/v2/data_var/");
		});
	});

	describe("Contract Generator - Constants", () => {
		it("should generate constants object", async () => {
			const code = await generateContractInterface([contractWithState]);

			// Should have constants object
			expect(code).toContain("constants: {");
			expect(code).toContain("tokenName: {");
			expect(code).toContain("tokenDecimals: {");
		});

		it("should generate get method for constants", async () => {
			const code = await generateContractInterface([contractWithState]);

			// Should use constant_val endpoint
			expect(code).toContain("/v2/constant_val/");
		});
	});

	describe("Contract Generator - Edge Cases", () => {
		it("should handle contract with no maps or variables", async () => {
			const simpleContract: ResolvedContract = {
				name: "simpleContract",
				address: "SP123",
				contractName: "simple",
				abi: {
					functions: [
						{
							name: "get-data",
							access: "read-only",
							args: [],
							outputs: "uint128",
						},
					],
				},
				source: "api",
			};

			const code = await generateContractInterface([simpleContract]);

			// Should not have maps/vars/constants accessors if not defined
			// (the <Contract>Types bundle always has a `maps:` key, so probe the
			// accessor implementation instead of the literal `maps: {`)
			expect(code).not.toContain("keyType:");
			expect(code).not.toContain("/v2/map_entry/");
			expect(code).not.toContain("vars: {");
			expect(code).not.toContain("constants: {");
		});

		it("should handle contract with only maps", async () => {
			const mapsOnlyContract: ResolvedContract = {
				name: "mapsContract",
				address: "SP123",
				contractName: "maps-only",
				abi: {
					functions: [],
					maps: [
						{
							name: "user-data",
							key: "principal",
							value: "uint128",
						},
					],
				},
				source: "api",
			};

			const code = await generateContractInterface([mapsOnlyContract]);

			expect(code).toContain("maps: {");
			expect(code).toContain("userData: {");
		});

		it("should handle complex map value types", async () => {
			const complexMapContract: ResolvedContract = {
				name: "complexMap",
				address: "SP123",
				contractName: "complex-map",
				abi: {
					functions: [],
					maps: [
						{
							name: "user-info",
							key: "principal",
							value: {
								tuple: [
									{ name: "balance", type: "uint128" },
									{ name: "last-update", type: "uint128" },
									{ name: "is-active", type: "bool" },
								],
							},
						},
					],
				},
				source: "api",
			};

			const code = await generateContractInterface([complexMapContract]);

			expect(code).toContain("maps: {");
			expect(code).toContain("userInfo: {");
		});
	});
});
