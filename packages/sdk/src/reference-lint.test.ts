import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Lint for the generated SDK reference. Every public method needs a JSDoc
 * summary, and the summary is the at-a-glance "use it to" line, so it stays
 * one short sentence in plain prose.
 *
 * Reads the generated JSON from disk (never imports `scripts/`, which would
 * break this package's `rootDir`). Regenerate with `bun run openpkg`.
 */
const REFERENCE = join(
	import.meta.dir,
	"../../../apps/web/src/generated/reference/sdk",
);

const MAX_SUMMARY_WORDS = 12;

type Method = { path: string; summary: string };

function readSurface(slug: string): string {
	return readFileSync(join(REFERENCE, `${slug}.json`), "utf8");
}

function readSlugs(): string[] {
	const index = JSON.parse(
		readFileSync(join(REFERENCE, "manifest.json"), "utf8"),
	) as { surfaces: { slug: string }[] };
	return index.surfaces.map((s) => s.slug);
}

function readMethods(): Method[] {
	return readSlugs().flatMap(
		(slug) => (JSON.parse(readSurface(slug)) as { methods: Method[] }).methods,
	);
}

describe("SDK reference documentation lint", () => {
	const methods = readMethods();

	test("every public method has a summary", () => {
		expect(methods.filter((m) => !m.summary).map((m) => m.path)).toEqual([]);
	});

	test(`a summary is at most ${MAX_SUMMARY_WORDS} words`, () => {
		const long = methods
			.filter((m) => m.summary.split(/\s+/).length > MAX_SUMMARY_WORDS)
			.map((m) => m.path);
		expect(long).toEqual([]);
	});

	test("a summary has no em dash", () => {
		expect(
			methods.filter((m) => /[—–]/.test(m.summary)).map((m) => m.path),
		).toEqual([]);
	});

	test("public documentation never cites an internal plan number", () => {
		const text = readSlugs().map(readSurface).join("\n");
		expect(text.match(/\bplan \d+/gi) ?? []).toEqual([]);
	});
});
