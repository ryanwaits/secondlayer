import { describe, expect, test } from "bun:test";
import { Cl, serializeCV } from "@secondlayer/stacks/clarity";
import type { ContractCallFilter } from "../types.ts";
import { buildContractCallInput } from "./runner.ts";
import type { MatchedTx } from "./source-matcher.ts";

// ABI matching the @secondlayer/stacks AbiContract shape (outputs is an AbiType).
const abi = {
	functions: [
		{
			name: "transfer-thing",
			access: "public",
			args: [
				{ name: "amount-ustx", type: "uint128" },
				{ name: "memo", type: { buff: { length: 4 } } },
			],
			outputs: "bool",
		},
	],
} as const;

function txWith(args: string[], fnName = "transfer-thing"): MatchedTx["tx"] {
	return { function_name: fnName, function_args: args } as MatchedTx["tx"];
}

describe("buildContractCallInput", () => {
	test("decodes named args via the ABI (camelCase names, ABI-typed values)", () => {
		const args = [
			serializeCV(Cl.uint(100n)),
			serializeCV(Cl.buffer(new Uint8Array([1, 2, 3, 4]))),
		];
		const input = buildContractCallInput(
			{ type: "contract_call", abi } as ContractCallFilter,
			txWith(args),
		);
		expect(input).toBeDefined();
		// uint128 → bigint; arg name kebab → camelCase
		expect(input?.amountUstx).toBe(100n);
		// buff → Uint8Array (not the hex string cvToValue would produce)
		expect(input?.memo).toBeInstanceOf(Uint8Array);
		expect(Array.from(input?.memo as Uint8Array)).toEqual([1, 2, 3, 4]);
	});

	test("returns undefined without an abi (back-compat: positional args only)", () => {
		const input = buildContractCallInput(
			{ type: "contract_call" } as ContractCallFilter,
			txWith([serializeCV(Cl.uint(1n))]),
		);
		expect(input).toBeUndefined();
	});

	test("returns undefined when the function isn't in the abi", () => {
		const input = buildContractCallInput(
			{ type: "contract_call", abi } as ContractCallFilter,
			txWith([serializeCV(Cl.uint(1n))], "no-such-fn"),
		);
		expect(input).toBeUndefined();
	});
});
