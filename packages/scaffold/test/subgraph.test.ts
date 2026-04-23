import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AbiFunction,
	type AbiMap,
	generateSubgraphCode,
} from "../src/subgraph.ts";

// Tmpdir inside the scaffold package so Node's import resolution can
// walk up to the monorepo's workspace `node_modules/@secondlayer/*`.
const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Round-trip: generated scaffold code must produce a SubgraphDefinition
 * that passes `validateSubgraphDefinition`. Guards against the
 * sources/handlers shape regression where scaffold emitted array
 * sources + `contractId::name` handler keys (incompatible with the
 * runtime's `Record<string, ...>` expectation).
 *
 * The generated code imports `@secondlayer/subgraphs` which resolves
 * against the monorepo workspace — write the code to a tmpfile nested
 * under this package so the import walks up to the root `node_modules`.
 */

const CONTRACT_ID = "SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173.test-contract";

async function generateAndLoad(
	functions: AbiFunction[],
	events: AbiMap[] = [],
) {
	const code = generateSubgraphCode(CONTRACT_ID, functions, "test", events);
	const dir = mkdtempSync(join(PKG_ROOT, ".scaffold-test-"));
	const path = join(dir, "subgraph.ts");
	writeFileSync(path, code);
	try {
		const mod = await import(`${path}?t=${Date.now()}`);
		return { def: mod.default, code };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Validator is imported lazily so the `@secondlayer/subgraphs`
// resolution runs against the workspace once subgraphs is built.
async function validate(def: unknown) {
	const { validateSubgraphDefinition } = await import(
		"@secondlayer/subgraphs/validate"
	);
	return validateSubgraphDefinition(def);
}

describe("scaffold → validate round-trip", () => {
	it("generated code passes validateSubgraphDefinition for public functions", async () => {
		const functions: AbiFunction[] = [
			{
				name: "transfer",
				access: "public",
				args: [
					{ name: "amount", type: "uint128" },
					{ name: "recipient", type: "principal" },
				],
				outputs: { type: { response: { ok: "bool", error: "uint128" } } },
			},
		];
		const { def } = await generateAndLoad(functions);
		const validated = await validate(def);
		expect(validated.name).toBe("test");
		expect(Object.keys(validated.sources)).toContain("transfer");
		expect(Object.keys(validated.handlers)).toContain("transfer");
		expect(validated.sources.transfer).toEqual({
			type: "contract_call",
			contractId: CONTRACT_ID,
			functionName: "transfer",
		});
	});

	it("generated code passes validate for print events (tuple payload)", async () => {
		const events: AbiMap[] = [
			{
				name: "swap-executed",
				key: "string-ascii",
				value: {
					tuple: [
						{ name: "pool-id", type: "uint128" },
						{ name: "trader", type: "principal" },
					],
				},
			},
		];
		const { def } = await generateAndLoad([], events);
		const validated = await validate(def);
		expect(Object.keys(validated.sources)).toContain("swap_executed");
		expect(Object.keys(validated.handlers)).toContain("swap_executed");
		expect(validated.sources.swap_executed).toEqual({
			type: "print_event",
			contractId: CONTRACT_ID,
			topic: "swap-executed",
		});
	});

	it("generated code matches sources keys to handlers keys (the regression)", async () => {
		const functions: AbiFunction[] = [
			{
				name: "mint",
				access: "public",
				args: [{ name: "amount", type: "uint128" }],
				outputs: { type: "bool" },
			},
			{
				name: "burn",
				access: "public",
				args: [{ name: "id", type: "uint128" }],
				outputs: { type: "bool" },
			},
		];
		const { def } = await generateAndLoad(functions);
		const sourceKeys = Object.keys(def.sources).sort();
		const handlerKeys = Object.keys(def.handlers).sort();
		expect(sourceKeys).toEqual(handlerKeys);
		expect(sourceKeys).toEqual(["burn", "mint"]);
	});
});
