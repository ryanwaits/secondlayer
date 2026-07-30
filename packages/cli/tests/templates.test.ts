import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
	SUBGRAPH_TEMPLATE_SLUGS,
	generateSubgraphTemplate,
} from "../src/templates/subgraph.ts";

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Templates are the first code a user ever sees, and they get copied. A
 * template that only *looks* right is how the shipped sip-010 starter came
 * to type its helper `ctx: any` — which modelled the non-commutative
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

describe("subgraph templates", () => {
	test("every template TYPE-CHECKS as real code", () => {
		for (const slug of SUBGRAPH_TEMPLATE_SLUGS) {
			const source = generateSubgraphTemplate("tmpl-test", slug);
			expect(typecheck(source), `template "${slug}"`).toEqual([]);
		}
	}, 60_000);

	test("no template reaches for `any` to get past the ctx type", () => {
		for (const slug of SUBGRAPH_TEMPLATE_SLUGS) {
			const source = generateSubgraphTemplate("tmpl-test", slug);
			expect(source, `template "${slug}"`).not.toContain("ctx: any");
			expect(source, `template "${slug}"`).not.toContain("biome-ignore");
		}
	});

	test("the balances starter moves money with increment, not read-modify-write", () => {
		const source = generateSubgraphTemplate("tmpl-test", "sip-010-balances");
		// Deltas commute and are replay-safe; findOne→compute→upsert loses
		// concurrent updates and double-counts under concurrent backfill.
		expect(source).toContain("ctx.increment(");
		// Scoped to the balances table: an upsert of immutable token metadata is
		// idempotent and fine — moving a BALANCE that way is what corrupts.
		expect(source).not.toContain('ctx.findOne("balances"');
		expect(source).not.toContain('ctx.upsert("balances"');
	});
});
