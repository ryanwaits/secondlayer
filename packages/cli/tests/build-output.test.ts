import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard: bundling `typescript` inlined the build machine's
 * `node_modules/typescript/lib` path (a maintainer home directory) into the
 * published dist/cli.js. dist/ must hold no absolute home path and no inlined
 * TypeScript.
 *
 * Requires `bun run build` first; it reads the built dist/ files, not source.
 */

const HOME_PATH = /\/(?:Users|home)\//;

for (const entry of ["cli.js", "index.js"] as const) {
	describe(`dist/${entry}`, () => {
		const source = readFileSync(
			join(import.meta.dir, "../dist", entry),
			"utf8",
		);

		test("contains no absolute home path", () => {
			expect(source.match(HOME_PATH)?.[0]).toBeUndefined();
		});

		test("does not inline typescript", () => {
			expect(source).not.toContain("typescript/lib");
		});
	});
}
