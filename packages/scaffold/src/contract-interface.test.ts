import { describe, expect, test } from "bun:test";
import { generateContractInterface } from "./contract-interface.ts";

describe("generateContractInterface", () => {
	test("emits a typed contract export with its methods", () => {
		const code = generateContractInterface([
			{
				name: "token",
				address: "SP1",
				contractName: "token",
				abi: {
					functions: [
						{
							name: "transfer",
							access: "public",
							args: [],
							outputs: {
								type: { response: { ok: "bool", error: "uint128" } },
							},
						},
					],
					maps: [],
					variables: [],
					fungible_tokens: [],
					non_fungible_tokens: [],
					// biome-ignore lint/suspicious/noExplicitAny: minimal ABI fixture
				} as any,
			},
		]);

		expect(code).toContain("export const token");
		expect(code).toContain("transfer");
	});

	test("imports resolve against current @secondlayer/stacks subpaths (no root imports)", () => {
		const code = generateContractInterface([]);

		expect(code).toContain(
			"import { Cl, type TypedAbi } from '@secondlayer/stacks/clarity'",
		);
		expect(code).toContain(
			"import { validateStacksAddress } from '@secondlayer/stacks/utils'",
		);
		// Root barrel does not export Cl/validateStacksAddress — never import from it
		expect(code).not.toContain("from '@secondlayer/stacks'\n");
	});

	test("emits named type aliases and brands the ABI const with TypedAbi", () => {
		const code = generateContractInterface([
			{
				name: "counter",
				address: "SP1",
				contractName: "counter",
				abi: {
					functions: [
						{
							name: "add",
							access: "public",
							args: [{ name: "n", type: "uint128" }],
							outputs: { response: { ok: "bool", error: "uint128" } },
						},
						{
							name: "get-count",
							access: "read-only",
							args: [],
							outputs: "uint128",
						},
						{
							name: "internal-bump",
							access: "private",
							args: [],
							outputs: "bool",
						},
					],
					maps: [{ name: "counts", key: "principal", value: "uint128" }],
					variables: [],
					fungible_tokens: [],
					non_fungible_tokens: [],
					// biome-ignore lint/suspicious/noExplicitAny: minimal ABI fixture
				} as any,
			},
		]);

		// Named per-function aliases
		expect(code).toContain("export type CounterAddArgs = { n: bigint }");
		expect(code).toContain(
			"export type CounterAddResult = { ok: boolean } | { err: bigint }",
		);
		expect(code).toContain(
			"export type CounterGetCountArgs = Record<string, never>",
		);
		expect(code).toContain("export type CounterGetCountResult = bigint");

		// Types bundle with camelCase keys, access preserved, maps included
		expect(code).toContain("export type CounterTypes = {");
		expect(code).toContain(
			"add: { args: CounterAddArgs; ret: CounterAddResult; access: 'public' }",
		);
		expect(code).toContain(
			"getCount: { args: CounterGetCountArgs; ret: CounterGetCountResult; access: 'read-only' }",
		);
		expect(code).toContain("counts: { key: string; value: bigint }");

		// Private functions excluded from aliases and bundle
		expect(code).not.toContain("InternalBump");
		expect(code).not.toContain("internalBump:");

		// ABI const branded with the types bundle
		expect(code).toContain("const _counterAbi = {");
		expect(code).toContain(
			"export const counterAbi: TypedAbi<typeof _counterAbi, CounterTypes> = _counterAbi",
		);

		// Method signatures use the named alias for the object-form overload
		expect(code).toContain("add(...args: [CounterAddArgs] | [bigint])");
	});

	test("map accessor serializes keys without Buffer-style toString", () => {
		const code = generateContractInterface([
			{
				name: "counter",
				address: "SP1",
				contractName: "counter",
				abi: {
					functions: [],
					maps: [{ name: "counts", key: "principal", value: "uint128" }],
					variables: [],
					fungible_tokens: [],
					non_fungible_tokens: [],
					// biome-ignore lint/suspicious/noExplicitAny: minimal ABI fixture
				} as any,
			},
		]);

		// serializeCV already returns hex — .toString('hex') was a drift bug
		expect(code).toContain("const keyHex = serializeCV(mapKey)");
		expect(code).not.toContain(".toString('hex')");
	});
});
