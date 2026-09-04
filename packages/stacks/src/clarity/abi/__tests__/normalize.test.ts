import { describe, expect, test } from "bun:test";
import { normalizeAbi } from "../normalize.ts";

/**
 * Shape returned by the Clarinet SDK's `getContractsInterfaces()` and the Hiro
 * contract-interface endpoint: `read_only` access, `{ type }`-wrapped outputs,
 * `buffer` instead of `buff`, plus token definitions.
 */
const RAW_TOKEN_ABI = {
	functions: [
		{
			name: "transfer",
			access: "public",
			args: [
				{ name: "amount", type: "uint128" },
				{ name: "memo", type: { optional: { buffer: { length: 34 } } } },
			],
			outputs: { type: { response: { ok: "bool", error: "uint128" } } },
		},
	],
	variables: [{ name: "total-supply", type: "uint128", access: "variable" }],
	maps: [{ name: "balances", key: "principal", value: "uint128" }],
	fungible_tokens: [{ name: "my-token" }],
	non_fungible_tokens: [{ name: "my-nft", type: "uint128" }],
};

describe("normalizing an ABI from the Hiro API or Clarinet SDK", () => {
	test("converts access, wrapped outputs and buffer types to the canonical shape", () => {
		const abi = normalizeAbi({
			...RAW_TOKEN_ABI,
			functions: [{ ...RAW_TOKEN_ABI.functions[0], access: "read_only" }],
		});

		expect(abi.functions[0]).toEqual({
			name: "transfer",
			access: "read-only",
			args: [
				{ name: "amount", type: "uint128" },
				{ name: "memo", type: { optional: { buff: { length: 34 } } } },
			],
			outputs: { response: { ok: "bool", error: "uint128" } },
		});
	});

	test("carries token definitions through, which filters need for contract::asset", () => {
		const abi = normalizeAbi(RAW_TOKEN_ABI);

		expect(abi.fungible_tokens).toEqual([{ name: "my-token" }]);
		expect(abi.non_fungible_tokens).toEqual([
			{ name: "my-nft", type: "uint128" },
		]);
	});

	test("normalizes a non-fungible token's identifier type", () => {
		const abi = normalizeAbi({
			functions: [],
			non_fungible_tokens: [
				{ name: "receipt", type: { buffer: { length: 32 } } },
			],
		});

		expect(abi.non_fungible_tokens).toEqual([
			{ name: "receipt", type: { buff: { length: 32 } } },
		]);
	});

	test("round-trips an already-canonical ABI without dropping fields", () => {
		const canonical = normalizeAbi(RAW_TOKEN_ABI);

		expect(normalizeAbi(canonical)).toEqual(canonical);
	});

	test("carries trait declarations through, dropping private trait functions", () => {
		const abi = normalizeAbi({
			functions: [],
			implemented_traits: ["SP123.sip-010-trait.sip-010-trait"],
			defined_traits: [
				{
					name: "vault-trait",
					functions: [
						{
							name: "deposit",
							access: "public",
							args: [{ name: "amount", type: "uint128" }],
							outputs: { type: "bool" },
						},
						{ name: "helper", access: "private", args: [], outputs: "bool" },
					],
				},
			],
		});

		expect(abi.implemented_traits).toEqual([
			"SP123.sip-010-trait.sip-010-trait",
		]);
		expect(abi.defined_traits).toEqual([
			{
				name: "vault-trait",
				functions: [
					{
						name: "deposit",
						access: "public",
						args: [{ name: "amount", type: "uint128" }],
						outputs: "bool",
					},
				],
			},
		]);
	});

	test("leaves absent sections undefined rather than empty arrays", () => {
		const abi = normalizeAbi({ functions: [] });

		expect(abi.maps).toBeUndefined();
		expect(abi.variables).toBeUndefined();
		expect(abi.fungible_tokens).toBeUndefined();
		expect(abi.non_fungible_tokens).toBeUndefined();
		expect(abi.implemented_traits).toBeUndefined();
		expect(abi.defined_traits).toBeUndefined();
	});

	test("ignores malformed entries instead of throwing", () => {
		const abi = normalizeAbi({
			functions: [],
			fungible_tokens: ["not-an-object"],
			implemented_traits: [{ nope: true }],
		});

		expect(abi.fungible_tokens).toBeUndefined();
		expect(abi.implemented_traits).toBeUndefined();
	});

	test("returns an empty ABI for a non-object input", () => {
		expect(normalizeAbi(null)).toEqual({ functions: [] });
	});
});
