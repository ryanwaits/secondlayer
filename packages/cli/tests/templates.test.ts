import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleSubgraphCode } from "@secondlayer/bundler";
import ts from "typescript";
import { generateSubgraphStarter } from "../src/templates/subgraph.ts";

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The starter is the first code a user ever sees, and it gets copied. A
 * starter that only *looks* right is how the retired sip-010 template came to
 * type its helper `ctx: any` — which modelled the non-commutative
 * read-modify-write the docs explicitly warn against, and produced a real
 * stored balance of -1489763 in production.
 */
function typecheck(source: string): string[] {
	const dir = mkdtempSync(join(PKG_ROOT, ".tmpl-tsc-"));
	const file = join(dir, "subgraph.ts");
	writeFileSync(file, source);
	try {
		const program = ts.createProgram([file], {
			strict: true,
			noEmit: true,
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			skipLibCheck: true,
		});
		return ts
			.getPreEmitDiagnostics(program)
			.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("subgraph starter", () => {
	test("TYPE-CHECKS as real code", () => {
		expect(typecheck(generateSubgraphStarter("tmpl-test"))).toEqual([]);
	}, 60_000);

	/**
	 * Type-checking is not enough on its own. The retired templates all
	 * type-checked and two of them still could not be deployed: the bundler
	 * stubs `@secondlayer/subgraphs` down to `defineSubgraph`, and the metadata
	 * extractor requires a flat object literal. Authoring and deploy were each
	 * tested; the seam between them was not. Assert the seam.
	 */
	test("BUNDLES through the real deploy path", async () => {
		const result = await bundleSubgraphCode(
			generateSubgraphStarter("tmpl-test"),
		);
		expect(result.name).toBe("tmpl-test");
		expect(Object.keys(result.sources)).toContain("handler");
		expect(Object.keys(result.schema)).toContain("data");
	}, 60_000);

	test("does not reach for `any` to get past the ctx type", () => {
		const source = generateSubgraphStarter("tmpl-test");
		expect(source).not.toContain("ctx: any");
		expect(source).not.toContain("biome-ignore");
	});

	test("does not promise a hosted login step", () => {
		const source = generateSubgraphStarter("tmpl-test");
		expect(source).not.toContain("log in");
		expect(source).not.toContain("hosted");
	});
});
