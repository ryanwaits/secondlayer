import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import GithubSlugger from "github-slugger";
import { docsNavPages } from "./nav";

/**
 * Docs prose rule: a paragraph has at most 3 sentences and at most 2 inline
 * code spans. Parallel things are a table, caveats a list, reference detail a
 * link. Paragraphs that already break it sit on prose-budget.allow.json, which
 * may only shrink. Regenerate it with `PROSE_BUDGET_WRITE=1 bun test <this file>`
 * after rewriting a page, and review the diff: it must only remove ids.
 */
const MAX_SENTENCES = 3;
const MAX_CODE_SPANS = 2;

const ALLOW_FILE = join(import.meta.dir, "prose-budget.allow.json");

/** Generated or log pages the rule does not apply to. */
const EXEMPT = new Set(["/docs/api-reference", "/docs/changelog"]);

function pageFile(href: string): string {
	const rel =
		href === "/docs" ? "page.mdx" : `${href.slice("/docs/".length)}/page.mdx`;
	return join(import.meta.dir, rel);
}

const FENCE = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;
const CODE_SPAN = /`[^`\n]+`/g;
const NON_PARAGRAPH = /^(#{1,6}\s|\||[-*]\s|\d+\.\s|<|>|import\s|export\s)/;

type Paragraph = { id: string; sentences: number; codeSpans: number };

function stripNonProse(mdx: string): string {
	return mdx
		.replace(/^export const metadata[\s\S]*?^};?\s*$/gm, "")
		.replace(/^export const \w+ = `[\s\S]*?`;\s*$/gm, "")
		.replace(FENCE, "");
}

function measure(text: string): { sentences: number; codeSpans: number } {
	const codeSpans = (text.match(CODE_SPAN) ?? []).length;
	const plain = text
		.replace(CODE_SPAN, "x")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
	const sentences = (plain.match(/[.!?](?=\s|$)/g) ?? []).length;
	return { sentences: Math.max(1, sentences), codeSpans };
}

function paragraphs(href: string, mdx: string): Paragraph[] {
	const slugger = new GithubSlugger();
	const out: Paragraph[] = [];
	let section = "intro";
	let buffer: string[] = [];
	let inList = false;

	const flush = () => {
		if (buffer.length === 0) return;
		const text = buffer.join(" ").replace(/\s+/g, " ").trim();
		buffer = [];
		if (!text) return;
		const { sentences, codeSpans } = measure(text);
		out.push({
			id: `${href}#${section}:${text.slice(0, 48)}`,
			sentences,
			codeSpans,
		});
	};

	for (const line of stripNonProse(mdx).split("\n")) {
		if (line.trim() === "") {
			flush();
			inList = false;
			continue;
		}
		const heading = /^(#{2,4})\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading) {
			flush();
			inList = false;
			section = slugger.slug(
				heading[2]
					.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
					.replace(/[`*_]/g, "")
					.trim(),
			);
			continue;
		}
		if (NON_PARAGRAPH.test(line)) {
			flush();
			inList = /^([-*]|\d+\.)\s/.test(line);
			continue;
		}
		// Indented continuation of a list item is part of the list.
		if (inList && /^\s/.test(line)) continue;
		inList = false;
		buffer.push(line.trim());
	}
	flush();
	return out;
}

const violations = docsNavPages()
	.filter(
		(p) =>
			!EXEMPT.has(p.href) &&
			!p.href.startsWith("/docs/api/") &&
			!p.href.startsWith("/docs/sdk-reference"),
	)
	.flatMap((p) => paragraphs(p.href, readFileSync(pageFile(p.href), "utf8")))
	.filter(
		(para) => para.sentences > MAX_SENTENCES || para.codeSpans > MAX_CODE_SPANS,
	);

if (process.env.PROSE_BUDGET_WRITE === "1") {
	const ids = [...new Set(violations.map((v) => v.id))].sort();
	writeFileSync(ALLOW_FILE, `${JSON.stringify(ids, null, "\t")}\n`);
}

const allow = new Set<string>(JSON.parse(readFileSync(ALLOW_FILE, "utf8")));

describe("docs prose rule", () => {
	test("no guide paragraph breaks the prose rule unless it is on the allowlist", () => {
		const fresh = violations.filter((v) => !allow.has(v.id));
		expect(
			fresh.map(
				(v) =>
					`${v.id} (${v.sentences} sentences, ${v.codeSpans} code spans; max ${MAX_SENTENCES} and ${MAX_CODE_SPANS})`,
			),
		).toEqual([]);
	});

	test("the allowlist only holds paragraphs that still break the rule", () => {
		const live = new Set(violations.map((v) => v.id));
		const stale = [...allow].filter((id) => !live.has(id));
		expect(
			stale,
			"remove these from prose-budget.allow.json (or run with PROSE_BUDGET_WRITE=1)",
		).toEqual([]);
	});
});
