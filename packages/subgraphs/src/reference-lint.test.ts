import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Lint for the generated subgraphs reference. Every exported function needs a
 * JSDoc summary, and the summary is the at-a-glance "use it to" line, so it
 * stays one short sentence in plain prose. A type a signature names is held to the same rule.
 *
 * Reads the generated JSON from disk (never imports `scripts/`, which would
 * break this package's `rootDir`). Regenerate with `bun run openpkg`.
 */
const REFERENCE = join(
	import.meta.dir,
	"../../../apps/web/src/generated/reference/subgraphs",
);

const MAX_SUMMARY_WORDS = 12;

type Method = { path: string; summary: string };

function readGroup(slug: string): string {
	return readFileSync(join(REFERENCE, `${slug}.json`), "utf8");
}

function readSlugs(): string[] {
	const manifest = JSON.parse(
		readFileSync(join(REFERENCE, "manifest.json"), "utf8"),
	) as { surfaces: { slug: string }[] };
	return manifest.surfaces.map((s) => s.slug);
}

function readMethods(): Method[] {
	return readSlugs().flatMap(
		(slug) => (JSON.parse(readGroup(slug)) as { methods: Method[] }).methods,
	);
}

type TypeDoc = { name: string; summary: string };
type Surface = {
	methods: {
		overloads: { params: { type: string }[]; returns: { type: string } }[];
	}[];
	types: TypeDoc[];
};

/** The types a method signature names: the ones a reader hovers on the page. */
function readSignatureTypes(): TypeDoc[] {
	const surfaces = readSlugs().map(
		(slug) => JSON.parse(readGroup(slug)) as Surface,
	);
	const signatures = surfaces
		.flatMap((s) => s.methods)
		.flatMap((m) => m.overloads)
		.flatMap((o) => [...o.params.map((p) => p.type), o.returns.type])
		.join("\n");
	return surfaces
		.flatMap((s) => s.types)
		.filter((t) => new RegExp(`\\b${t.name}\\b`).test(signatures));
}

describe("subgraphs reference documentation lint", () => {
	const methods = readMethods();

	test("every exported function has a summary", () => {
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

	const signatureTypes = readSignatureTypes();

	test("every type a signature names has a summary", () => {
		expect(signatureTypes.filter((t) => !t.summary).map((t) => t.name)).toEqual(
			[],
		);
	});

	test(`a type summary is at most ${MAX_SUMMARY_WORDS} words`, () => {
		const long = signatureTypes
			.filter((t) => t.summary.split(/\s+/).length > MAX_SUMMARY_WORDS)
			.map((t) => t.name);
		expect(long).toEqual([]);
	});

	test("a type summary has no em dash", () => {
		expect(
			signatureTypes.filter((t) => /[—–]/.test(t.summary)).map((t) => t.name),
		).toEqual([]);
	});

	test("public documentation never cites an internal plan number", () => {
		const text = readSlugs().map(readGroup).join("\n");
		expect(text.match(/\bplan \d+/gi) ?? []).toEqual([]);
	});
});
