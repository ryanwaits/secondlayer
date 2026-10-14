import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Lint for the generated filters reference. Every type a function signature
 * names has a one-sentence summary, because that summary is the hover tip.
 *
 * Reads the generated JSON from disk (never imports `scripts/`, which would
 * break this package's `rootDir`). Regenerate with `bun run openpkg`.
 */
const REFERENCE = join(
	import.meta.dir,
	"../../../apps/web/src/generated/reference/filters",
);

const MAX_SUMMARY_WORDS = 12;

type TypeDoc = { name: string; summary: string };
type Surface = {
	methods: {
		overloads: { params: { type: string }[]; returns: { type: string } }[];
	}[];
	types: TypeDoc[];
};

function readSurfaces(): Surface[] {
	const manifest = JSON.parse(
		readFileSync(join(REFERENCE, "manifest.json"), "utf8"),
	) as { surfaces: { slug: string }[] };
	return manifest.surfaces.map(
		(s) =>
			JSON.parse(
				readFileSync(join(REFERENCE, `${s.slug}.json`), "utf8"),
			) as Surface,
	);
}

/** The types a function signature names: the ones a reader hovers on the page. */
function readSignatureTypes(): TypeDoc[] {
	const surfaces = readSurfaces();
	const signatures = surfaces
		.flatMap((s) => s.methods)
		.flatMap((m) => m.overloads)
		.flatMap((o) => [...o.params.map((p) => p.type), o.returns.type])
		.join("\n");
	return surfaces
		.flatMap((s) => s.types)
		.filter((t) => new RegExp(`\\b${t.name}\\b`).test(signatures));
}

describe("filters reference documentation lint", () => {
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
});
