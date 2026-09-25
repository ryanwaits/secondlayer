import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLER_EXTERNALS } from "../src/build-externals";

/**
 * Regression guard for the 16.0.0–16.3.0 crash: `@stacks/clarinet-sdk` is an
 * optional peer dependency, but bunup's `splitting: false` + `external`
 * config kept a top-level static `import ... from "@stacks/clarinet-sdk"` in
 * dist/cli.js, so `bunx @secondlayer/cli --version` crashed with
 * "Cannot find module" on any install that skipped the optional peer.
 *
 * This asserts none of bunup's externals that aren't real `dependencies`
 * (only dev/peer/optional) appear as a top-level static import/export in the
 * built output. A dynamic `import("pkg")` is fine — it only runs, and only
 * throws, when the code path that needs the package is actually reached.
 *
 * Requires `bun run build` first; it reads the built dist/ files, not source.
 */

const pkgJson = JSON.parse(
	readFileSync(join(import.meta.dir, "../package.json"), "utf8"),
) as { dependencies?: Record<string, string> };

const realDependencies = new Set(Object.keys(pkgJson.dependencies ?? {}));

const optionalExternals = BUNDLER_EXTERNALS.filter(
	(name) => !realDependencies.has(name),
);

function staticImportPattern(packageName: string): RegExp {
	const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// `import ... from "pkg"` / `export ... from "pkg"`, at the start of a
	// statement (allowing leading whitespace/semicolons from minification),
	// and never matching a dynamic `import("pkg")` call.
	return new RegExp(
		`(?:^|;)\\s*(?:import|export)(?!\\()[^;]*from\\s*["']${escaped}["']`,
	);
}

describe("dist/ never statically imports an optional dependency", () => {
	test(`bunup externals not in dependencies: ${optionalExternals.join(", ")}`, () => {
		// Sanity check the fixture itself: @stacks/clarinet-sdk must always be
		// in this list, since it's the exact package that caused the crash.
		expect(optionalExternals).toContain("@stacks/clarinet-sdk");
	});

	for (const entry of ["cli.js", "index.js"] as const) {
		test(`dist/${entry} has no top-level static import of an optional external`, () => {
			const distPath = join(import.meta.dir, "../dist", entry);
			const source = readFileSync(distPath, "utf8");

			const offenders = optionalExternals.filter((name) =>
				staticImportPattern(name).test(source),
			);

			expect(offenders).toEqual([]);
		});
	}
});
