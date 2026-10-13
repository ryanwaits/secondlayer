import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { docsNavPages } from "./nav";

/** Docs page contract: about 120 words visible per `##` section on entry. Collapsed <details> and code don't count. */
const BUDGET = 120;

/** Generated or log pages the contract does not apply to. */
const EXEMPT = new Set([
	"/docs/api-reference",
	"/docs/sdk-reference",
	"/docs/changelog",
]);

function pageFile(href: string): string {
	const rel =
		href === "/docs" ? "page.mdx" : `${href.slice("/docs/".length)}/page.mdx`;
	return join(import.meta.dir, rel);
}

/** Words a reader sees on entry: prose, headings and table cells; not code or collapsed rows. */
function visibleWords(mdx: string): number {
	const text = mdx
		.replace(/^export const metadata[\s\S]*?^};?\s*$/gm, "")
		.replace(/^export const \w+ = `[\s\S]*?`;\s*$/gm, "")
		.replace(/^import .*$/gm, "")
		.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "")
		.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/^\|[\s|:-]*\|$/gm, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
	return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/** Visible words per `##` section; text before the first `##` is the intro. */
function sectionWords(mdx: string): { section: string; words: number }[] {
	// Fenced code can hold lines that start with "## " (shell comments); blank them before splitting.
	const flat = mdx.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (m) =>
		m.replace(/^## /gm, "#  "),
	);
	return flat.split(/^## /m).map((chunk, i) => ({
		section: i === 0 ? "intro" : (chunk.split("\n", 1)[0] ?? "").trim(),
		words: visibleWords(i === 0 ? chunk : `## ${chunk}`),
	}));
}

const counts = docsNavPages()
	.filter((p) => !EXEMPT.has(p.href))
	.flatMap((p) =>
		sectionWords(readFileSync(pageFile(p.href), "utf8")).map((s) => ({
			...s,
			href: p.href,
		})),
	);

describe("docs word budget", () => {
	test("every section stays within the entry budget", () => {
		const over = counts.filter((c) => c.words > BUDGET);
		expect(
			over.map(
				(c) => `${c.href} › ${c.section}: ${c.words} words (max ${BUDGET})`,
			),
		).toEqual([]);
	});
});
