import { describe, expect, test } from "bun:test";
import { generateContractHooks } from "../src/plugins/react/generators/contract";
import { generateGenericHooks } from "../src/plugins/react/generators/generic";

const CONTRACT = {
	name: "token",
	address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
	contractName: "token",
	abi: {
		functions: [
			{
				name: "get-balance",
				access: "read-only",
				args: [{ name: "account", type: "principal" }],
				outputs: { response: { ok: "uint128", error: "uint128" } },
			},
			{
				name: "transfer",
				access: "public",
				args: [{ name: "amount", type: "uint128" }],
				outputs: { response: { ok: "bool", error: "uint128" } },
			},
		],
		maps: [],
		variables: [],
	},
	// biome-ignore lint/suspicious/noExplicitAny: minimal fixture
} as any;

describe("react plugin generated imports", () => {
	test("generic hooks import only real @secondlayer/stacks subpaths", async () => {
		const code = await generateGenericHooks();

		expect(code).toContain("from '@secondlayer/stacks/clarity'");
		expect(code).toContain(
			"import { validateStacksAddress } from '@secondlayer/stacks/utils'",
		);
		expect(code).toContain(
			"import type { PostCondition } from '@secondlayer/stacks/postconditions'",
		);
		// Root barrel exports none of these — never import from it
		expect(code).not.toContain("from '@secondlayer/stacks'\n");
		// fetchCallReadOnlyFunction never existed in @secondlayer/stacks
		expect(code).not.toContain("fetchCallReadOnlyFunction");
		// connect() takes no arguments in the current SDK
		expect(code).not.toContain("connect(options)");
	});

	test("contract hooks import PostCondition from the postconditions subpath", async () => {
		const code = await generateContractHooks([CONTRACT]);

		expect(code).toContain(
			"import type { PostCondition } from '@secondlayer/stacks/postconditions'",
		);
		expect(code).not.toContain("from '@secondlayer/stacks'\n");
	});

	test("read hooks use the contract descriptor + call-read, not a .read namespace", async () => {
		const code = await generateContractHooks([CONTRACT]);

		// The `.read.` namespace only existed on the removed actions plugin output
		expect(code).not.toContain("token.read.");
		expect(code).toContain("token.getBalance({ account: account })");
		expect(code).toContain("readContractCall({");
		expect(code).toContain("/v2/contracts/call-read/");
		// Result converts through the ABI output type
		expect(code).toContain("outputType:");
	});

	test("write hooks call descriptor methods directly", async () => {
		const code = await generateContractHooks([CONTRACT]);
		expect(code).toContain("token.transfer(args)");
		expect(code).toContain("request('stx_callContract'");
	});
});
