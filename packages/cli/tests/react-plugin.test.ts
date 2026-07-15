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

		// Extract every `import [type] { ... } from '<module>'` statement,
		// tolerant of formatCode's line-wrapping, and map named imports to
		// their source module.
		const importRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'([^']+)'/gs;
		const moduleByName = new Map<string, string>();
		for (const [, names, mod] of code.matchAll(importRe)) {
			for (const raw of names.split(",")) {
				const name = raw.trim();
				if (name) moduleByName.set(name, mod);
			}
		}

		expect(moduleByName.get("Cl")).toBe("@secondlayer/stacks/clarity");
		expect(moduleByName.get("validateStacksAddress")).toBe(
			"@secondlayer/stacks/utils",
		);
		expect(moduleByName.get("PostCondition")).toBe(
			"@secondlayer/stacks/postconditions",
		);
		expect(moduleByName.get("ExtractFunctionArgs")).toBe(
			"@secondlayer/stacks/clarity",
		);
		expect(moduleByName.get("getTransaction")).toBe(
			"@secondlayer/stacks/actions",
		);
		expect(moduleByName.get("waitForTransactionReceipt")).toBe(
			"@secondlayer/stacks/actions",
		);
		// createPublicClient/http are root-only (no dedicated subpath) — the one
		// legitimate root import. Everything else above must use its subpath,
		// never the bare root barrel.
		expect(moduleByName.get("createPublicClient")).toBe("@secondlayer/stacks");
		expect(moduleByName.get("http")).toBe("@secondlayer/stacks");
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
