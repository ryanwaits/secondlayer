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
});
