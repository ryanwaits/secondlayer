import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tipTextProblem } from "@/components/code/prose";
import { Glob } from "bun";
import remarkCodeTips, { isGuide, routeOf } from "../remark-code-tips.mjs";
import {
	ANNOTATION_LIMITS,
	ANNOTATION_NAMES,
	parseAnnotations,
	parseFenceOptions,
} from "./annotations";
import { proseProblems, scopesOf } from "./scopes";

const LIMITS = ANNOTATION_LIMITS;

const ROOT = join(import.meta.dir, "..", "..", "app", "(www)");
const FENCE = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm;

/** Automatic tips across every guide: past this, a page is tipping what it should be teaching. */
const GUIDE_TIP_CEILING = 35; // +1: listen-for-contract-events (/api/webhooks)
/** Most prose tips under one `##`. */
const PROSE_TIPS_PER_SECTION = 2;

type Fence = {
	file: string;
	where: string;
	lang: string;
	body: string;
};

const mdxFiles = [...new Glob("**/*.mdx").scanSync(ROOT)];
const source = (file: string) => readFileSync(join(ROOT, file), "utf8");
const routeOfFile = (file: string) => routeOf(join(ROOT, file));
const isGuideFile = (file: string) => isGuide(routeOfFile(file));

function fences(): Fence[] {
	const out: Fence[] = [];
	for (const file of mdxFiles) {
		let n = 0;
		for (const m of source(file).matchAll(FENCE)) {
			n++;
			out.push({
				file,
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
	for (const file of mdxFiles) found.push(...proseProblems(file, source(file)));
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
			if (a.name === "tip" && !isGuideFile(f.file))
				found.push(`${f.where}: !tip is for guides only`);
		}
	}
	return found;
}

/** Prose `[text](tip "words")` tips: only in guides, two per `##`, each with words that pass `tipTextProblem`. */
function proseTipProblems(): string[] {
	const found: string[] = [];
	for (const file of mdxFiles) {
		for (const scope of scopesOf(source(file), false)) {
			const tips = [...scope.prose.matchAll(/\]\(tip\s+"([^"]*)"\)/g)].map(
				(m) => m[1] ?? "",
			);
			const where = `${file} "${scope.where}"`;
			if (tips.length && !isGuideFile(file))
				found.push(`${where}: prose tips are for guides only`);
			if (tips.length > PROSE_TIPS_PER_SECTION)
				found.push(
					`${where}: ${tips.length} prose tips (max ${PROSE_TIPS_PER_SECTION})`,
				);
			for (const text of tips) {
				const problem = tipTextProblem(text);
				if (problem) found.push(`${where}: tip "${text}" ${problem}`);
			}
		}
	}
	return found;
}

/** Product pages carry no tips: no `tips=`, no `!tip`, no prose tip. A product page shows what it sells, it does not explain it. */
function productTipProblems(): string[] {
	const found: string[] = [];
	const pattern = /\btips=|(?:\/\/|#)\s*!tip\b|\]\(tip[\s"]/;
	for (const dir of ["p", "verify", "data"])
		for (const file of new Glob(`${dir}/**/*.{ts,tsx,mdx}`).scanSync(ROOT)) {
			if (/\.test\.tsx?$/.test(file)) continue;
			if (pattern.test(source(file)))
				found.push(`${file}: product pages carry no tips`);
		}
	return found;
}

type Node = { type: string; [key: string]: unknown };

/** An MDX file as the few nodes the tip plugin reads: `##` headings, fences, and `<CodeTabs>` groups. */
function sketch(text: string): Node {
	const root: Node & { children: Node[] } = { type: "root", children: [] };
	let group: (Node & { children: Node[] }) | null = null;
	let fence: { mark: string; lang: string; body: string[] } | null = null;
	for (const line of text.split("\n")) {
		if (fence) {
			if (line.trim() === fence.mark) {
				(group ?? root).children.push({
					type: "code",
					lang: fence.lang,
					value: fence.body.join("\n"),
				});
				fence = null;
			} else fence.body.push(line);
			continue;
		}
		const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
		if (open) {
			fence = {
				mark: open[1] as string,
				lang: parseFenceOptions(open[2] ?? "").lang,
				body: [],
			};
			continue;
		}
		if (/^<CodeTabs\b/.test(line)) {
			group = { type: "mdxJsxFlowElement", name: "CodeTabs", children: [] };
			root.children.push(group);
		} else if (/^<\/CodeTabs>/.test(line)) group = null;
		else if (/^##\s/.test(line))
			root.children.push({ type: "heading", depth: 2 });
	}
	return root;
}

/** The names each guide's blocks would tip, by file. */
function guideTips(): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const file of mdxFiles) {
		if (!isGuideFile(file)) continue;
		const tree = sketch(source(file));
		remarkCodeTips()(tree, { path: join(ROOT, file) });
		const names: string[] = [];
		const visit = (node: Node) => {
			const tips = (
				node.data as { hProperties?: Record<string, string> } | undefined
			)?.hProperties?.["data-tips"];
			if (tips) names.push(...tips.split(" "));
			for (const child of (node.children as Node[] | undefined) ?? [])
				visit(child);
		};
		visit(tree);
		if (names.length) out.set(file, names);
	}
	return out;
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

describe("tip rules", () => {
	test("prose tips stay in guides, two per section, with words that read in a glance", () => {
		expect(proseTipProblems()).toEqual([]);
	});

	test("product pages carry no tips", () => {
		expect(productTipProblems()).toEqual([]);
	});

	test("the guides' automatic tips stay under the ceiling", () => {
		const tips = guideTips();
		const total = [...tips.values()].reduce((n, names) => n + names.length, 0);
		expect(total, JSON.stringify([...tips])).toBeLessThanOrEqual(
			GUIDE_TIP_CEILING,
		);
		// The plugin is wired to real pages: some guide tips something.
		expect(total).toBeGreaterThan(0);
	});

	test("a page that is not a guide gets no automatic tip", () => {
		for (const file of mdxFiles) {
			if (isGuideFile(file)) continue;
			const tree = sketch(source(file));
			remarkCodeTips()(tree, { path: join(ROOT, file) });
			expect(JSON.stringify(tree), file).not.toContain("data-tips");
		}
	});
});
