import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAnnotations } from "@/lib/code/annotations";
import { docsNavPages } from "./nav";

/** Docs page contract: a `##` section opens with at most 120 words before its first subheading. Code doesn't count. */
const BUDGET = 120;

/** Generated or log pages the contract does not apply to (the six API pages
 *  under /docs/api/ are generated from the spec too). */
const EXEMPT = new Set(["/docs/api-reference", "/docs/changelog"]);

function pageFile(href: string): string {
	const rel =
		href === "/docs" ? "page.mdx" : `${href.slice("/docs/".length)}/page.mdx`;
	return join(import.meta.dir, rel);
}

/** Words a reader sees: prose, headings and table cells; not code. */
function visibleWords(mdx: string): number {
	const text = mdx
		.replace(/^export const metadata[\s\S]*?^};?\s*$/gm, "")
		.replace(/^export const \w+ = `[\s\S]*?`;\s*$/gm, "")
		.replace(/^import .*$/gm, "")
		.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/^\|[\s|:-]*\|$/gm, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
	return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

const FENCE = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm;

/** A fence reads as its `!callout` notes: they are prose the reader sees, so they count; the code does not. */
function fencesToCallouts(mdx: string): string {
	return mdx.replace(FENCE, (_m, _fence, info: string, body: string) =>
		parseAnnotations(body, info.trim().split(/\s+/)[0] ?? "")
			.annotations.filter((a) => a.name === "callout")
			.map((a) => a.value)
			.join("\n"),
	);
}

/** Lead words per `##` section: its text up to the first `###`/`####`; text before the first `##` is the intro. */
function sectionWords(mdx: string): { section: string; words: number }[] {
	// Fenced code can hold lines that start with "#" (shell comments); reduce each fence to its callout text before splitting.
	const flat = fencesToCallouts(mdx);
	return flat.split(/^## /m).map((chunk, i) => {
		const lead = chunk.split(/^#{3,4} /m, 1)[0] ?? "";
		return {
			section: i === 0 ? "intro" : (chunk.split("\n", 1)[0] ?? "").trim(),
			words: visibleWords(i === 0 ? lead : `## ${lead}`),
		};
	});
}

const counts = docsNavPages()
	.filter(
		(p) =>
			!EXEMPT.has(p.href) &&
			!p.href.startsWith("/docs/api/") &&
			!p.href.startsWith("/docs/sdk-reference"),
	)
	.flatMap((p) =>
		sectionWords(readFileSync(pageFile(p.href), "utf8")).map((s) => ({
			...s,
			href: p.href,
		})),
	);

describe("docs word budget", () => {
	test("every section's lead stays within the budget", () => {
		const over = counts.filter((c) => c.words > BUDGET);
		expect(
			over.map(
				(c) => `${c.href} › ${c.section}: ${c.words} words (max ${BUDGET})`,
			),
		).toEqual([]);
	});
});
