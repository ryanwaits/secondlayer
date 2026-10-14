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

	test("in a post the whole file is the section", () => {
		expect(proseProblems("writing/(post)/p/page.mdx", two)[0]).toContain(
			"2 pick names",
		);
	});
});
