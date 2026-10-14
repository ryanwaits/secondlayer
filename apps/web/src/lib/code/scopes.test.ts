import { describe, expect, test } from "bun:test";
import { proseProblems, scopesOf } from "./scopes";

const fence = (body: string, lang = "ts") => `\`\`\`${lang}\n${body}\n\`\`\``;

describe("scopes", () => {
	test("a docs page splits at ## and ignores ## inside a fence", () => {
		const source = [
			"intro",
			"## One",
			fence("## not a heading\nx();"),
			"## Two",
			"text",
		].join("\n");
		expect(scopesOf(source, false).map((s) => s.where)).toEqual([
			"intro",
			"One",
			"Two",
		]);
		expect(scopesOf(source, false)[1]?.fences).toHaveLength(1);
	});

	test("a writing post is one scope", () => {
		expect(scopesOf("a\n## One\nb\n## Two\nc", true)).toHaveLength(1);
	});
});

describe("mention and focus links", () => {
	const block = fence("// !ref[/next_cursor/] next\nx(page.next_cursor);");

	test("a hover or focus name needs a !ref in the same section", () => {
		const source = `## One\n${block}\n[a](hover:next) [b](focus:next)\n## Two\n[c](hover:next) [d](focus:gone)`;
		expect(proseProblems("docs/x/page.mdx", source)).toEqual([
			'docs/x/page.mdx "Two": hover:next has no !ref next in the section',
			'docs/x/page.mdx "Two": focus:gone has no !ref gone in the section',
		]);
	});

	test("in a post a ref anywhere satisfies a mention anywhere", () => {
		const source = `[a](hover:next)\n## One\n${block}`;
		expect(proseProblems("writing/(post)/p/page.mdx", source)).toEqual([]);
	});
});

describe("pick budget", () => {
	const two = `## Section\n${fence("// !pick[/a/] one: a | b\na();")}\n${fence("// !pick[/c/] two: c | d\nc();")}`;

	test("two pick names in one section fail", () => {
		expect(proseProblems("docs/x/page.mdx", two)[0]).toContain("2 pick names");
	});

	test("the same name across fences, or one per section, passes", () => {
		const same = `## S\n${fence("// !pick[/a/] one: a | b\na();")}\n${fence("// !pick[/a/] one\na();")}`;
		expect(proseProblems("docs/x/page.mdx", same)).toEqual([]);
		const split = `## S\n${fence("// !pick[/a/] one: a | b\na();")}\n## T\n${fence("// !pick[/c/] two: c | d\nc();")}`;
		expect(proseProblems("docs/x/page.mdx", split)).toEqual([]);
	});

	test("a Pick chip row needs the !pick it drives", () => {
		const source = `## S\n<Pick name="event" />\n${fence("// !pick[/a/] event: a | b\na();")}\n## T\n<Pick name="event" />`;
		expect(proseProblems("docs/x/page.mdx", source)).toEqual([
			'docs/x/page.mdx "T": <Pick name="event"> has no !pick event',
		]);
	});

	test("in a post the whole file is the section", () => {
		expect(proseProblems("writing/(post)/p/page.mdx", two)[0]).toContain(
			"2 pick names",
		);
	});
});
