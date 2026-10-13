import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { docsNavPages } from "./nav";

/** Docs page contract: ≤400 words visible on entry. Collapsed <details> and code don't count. */
const BUDGET = 400;

/** Pages not yet rewritten to the contract. Plans remove entries as they rewrite pages; never add one. */
const PENDING_REWRITE = new Set<string>([
	"/docs/authentication",
	"/docs/self-host/production",
	"/docs/archive",
	"/docs/streams",
	"/docs/index",
	"/docs/subgraphs",
	"/docs/subgraphs/handlers",
	"/docs/subgraphs/reading",
	"/docs/webhooks",
	"/docs/webhooks/deliveries",
	"/docs/verification",
	"/docs/cli",
	"/docs/sdk",
	"/docs/sinks",
	"/docs/deploy",
	"/docs/rest-api",
]);

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

const counts = docsNavPages()
	.filter((p) => !EXEMPT.has(p.href))
	.map((p) => ({
		href: p.href,
		words: visibleWords(readFileSync(pageFile(p.href), "utf8")),
	}));

describe("docs word budget", () => {
	test("pages that follow the contract stay within the entry budget", () => {
		const over = counts.filter(
			(c) => !PENDING_REWRITE.has(c.href) && c.words > BUDGET,
		);
		expect(
			over.map((c) => `${c.href}: ${c.words} words (max ${BUDGET})`),
		).toEqual([]);
	});

	test("pending pages are still over budget, so the set only shrinks", () => {
		const fixed = counts.filter(
			(c) => PENDING_REWRITE.has(c.href) && c.words <= BUDGET,
		);
		expect(
			fixed.map(
				(c) => `${c.href}: ${c.words} words, remove from PENDING_REWRITE`,
			),
		).toEqual([]);
	});
});
