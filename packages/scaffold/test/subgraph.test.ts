import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
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

/**
 * TYPE-check generated source with the real compiler. Runtime import +
 * validate (above) never caught handlers reading fields that don't exist on
 * the payload — `event.amount` loads, validates, and inserts `undefined`
 * forever. Only tsc sees it. Every scaffold emit path must pass through here.
 */
function typecheckGenerated(...files: string[]): string[] {
	const program = ts.createProgram(files, {
		strict: true,
		noEmit: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		skipLibCheck: true,
	});
	return ts
		.getPreEmitDiagnostics(program)
		.map(
			(d) =>
				`${d.file?.fileName ?? "?"}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
		);
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

	it("handlers read fields that exist on the payload (the phantom-field regression)", async () => {
		// contract_call args are positional (`event.args[i]`) until the source
		// carries an `abi`; `event.<argName>` does not exist on the payload and
		// inserted `undefined` into every generated column.
		const functions: AbiFunction[] = [
			{
				name: "transfer",
				access: "public",
				args: [
					{ name: "amount", type: "uint128" },
					{ name: "recipient", type: "principal" },
				],
				outputs: { type: "bool" },
			},
		];
		const { code } = await generateAndLoad(functions);
		expect(code).toContain("event.args[0] as bigint");
		expect(code).toContain("event.args[1] as string");
		expect(code).not.toMatch(/event\.amount\b/);
		expect(code).not.toMatch(/event\.recipient\b/);

		// print tuple fields live under `event.data.<camelName>`.
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
		const printResult = await generateAndLoad([], events);
		expect(printResult.code).toContain("event.data.poolId as bigint");
		expect(printResult.code).toContain("event.data.trader as string");
		expect(printResult.code).not.toMatch(/event\.poolId\b/);
	});

	it("generated code TYPE-CHECKS against the real payload types", () => {
		const functions: AbiFunction[] = [
			{
				name: "transfer",
				access: "public",
				args: [
					{ name: "amount", type: "uint128" },
					{ name: "recipient", type: "principal" },
				],
				outputs: { type: "bool" },
			},
		];
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
		const dir = mkdtempSync(join(PKG_ROOT, ".scaffold-tsc-"));
		try {
			const fnPath = join(dir, "functions.ts");
			const evPath = join(dir, "events.ts");
			writeFileSync(fnPath, generateSubgraphCode(CONTRACT_ID, functions, "t1"));
			writeFileSync(
				evPath,
				generateSubgraphCode(CONTRACT_ID, [], "t2", events),
			);

			// Negative control: the pre-fix emit shape (`event.<argName>`) MUST
			// fail here — proves this harness catches the phantom-field class.
			const phantomPath = join(dir, "phantom.ts");
			writeFileSync(
				phantomPath,
				generateSubgraphCode(CONTRACT_ID, functions, "t3").replace(
					"event.args[0] as bigint",
					"event.amount",
				),
			);

			expect(typecheckGenerated(fnPath, evPath)).toEqual([]);
			const phantomErrors = typecheckGenerated(phantomPath);
			expect(phantomErrors.length).toBeGreaterThan(0);
			expect(phantomErrors.join("\n")).toContain("amount");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30_000);

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
