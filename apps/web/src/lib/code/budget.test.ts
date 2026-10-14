import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import {
	ANNOTATION_NAMES,
	parseAnnotations,
	parseFenceOptions,
} from "./annotations";
import { proseProblems } from "./scopes";

/** A block that marks everything marks nothing: these limits keep color meaningful. */
const LIMITS = { mark: 2, callout: 3, focus: 1 } as const;

const ROOT = join(import.meta.dir, "..", "..", "app", "(www)");
const FENCE = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm;

type Fence = { where: string; lang: string; body: string };

function fences(): Fence[] {
	const out: Fence[] = [];
	for (const file of new Glob("**/*.mdx").scanSync(ROOT)) {
		const source = readFileSync(join(ROOT, file), "utf8");
		let n = 0;
		for (const m of source.matchAll(FENCE)) {
			n++;
			out.push({
				where: `${file} fence ${n}`,
				lang: parseFenceOptions(m[2] ?? "").lang,
				body: m[3] ?? "",
			});
		}
	}
	return out;
}

const all = fences();

function proseWiring(): string[] {
	const found: string[] = [];
	for (const file of new Glob("**/*.mdx").scanSync(ROOT))
		found.push(...proseProblems(file, readFileSync(join(ROOT, file), "utf8")));
	return found;
}

function problems(): string[] {
	const found: string[] = [];
	for (const f of all) {
		const { annotations } = parseAnnotations(f.body, f.lang);
		const count = (name: string) =>
			annotations.filter((a) => a.name === name).length;
		for (const [name, max] of Object.entries(LIMITS))
			if (count(name) > max)
				found.push(`${f.where}: ${count(name)} ${name} (max ${max})`);
		for (const a of annotations) {
			if (!(ANNOTATION_NAMES as readonly string[]).includes(a.name))
				found.push(`${f.where}: unknown annotation !${a.name}`);
			if (a.name === "mark" && a.value === "blue")
				found.push(`${f.where}: mark blue is for figures only`);
			if (a.name === "mark" && a.value === "red" && f.lang !== "text")
				found.push(`${f.where}: mark red is for text output only`);
		}
	}
	return found;
}

describe("code annotation budgets", () => {
	test("every docs fence stays within the annotation budgets", () => {
		expect(problems()).toEqual([]);
	});

	test("every section's prose points only at code that exists", () => {
		expect(proseWiring()).toEqual([]);
	});

	test("the scan finds the docs' fences", () => {
		expect(all.length).toBeGreaterThan(50);
	});
});
