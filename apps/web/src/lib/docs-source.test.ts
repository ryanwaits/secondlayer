import { describe, expect, test } from "bun:test";
import docsPhrasings from "@/generated/docs-phrasings.json";
import apiNav from "@/generated/openapi-nav.json";
import { docsSearchPool } from "./command-center/items";
import {
	docsHeadingIndex,
	docsSearchDocs,
	docsSectionList,
	extractAgentNotes,
	headingsFromMdx,
	mdxToMarkdown,
	readAllDocsMarkdown,
	readDocsMarkdown,
	sectionsFromMdx,
} from "./docs-source";

describe("extractAgentNotes", () => {
	test("pulls a multi-line block with blank lines and removes it entirely", () => {
		const source = [
			"# Title",
			"",
			"export const agent = `",
			"- first rule",
			"",
			"- second rule",
			"`;",
			"",
			"export const metadata = { title: 'x' };",
			"",
			"Body.",
		].join("\n");
		const { notes, rest } = extractAgentNotes(source);
		expect(notes).toBe("- first rule\n\n- second rule");
		expect(rest).not.toContain("export const agent");
		expect(rest).not.toContain("second rule");
		expect(rest).toContain("Body.");
	});

	test("returns null notes and untouched source when there is no block", () => {
		const source = "# Title\n\nBody.\n";
		expect(extractAgentNotes(source)).toEqual({ notes: null, rest: source });
	});
});

describe("mdxToMarkdown", () => {
	test("turns multi-line details into a heading with no html left", () => {
		const md = mdxToMarkdown(
			[
				'<details id="options">',
				"<summary>Options</summary>",
				"",
				"Body text.",
				"",
				"</details>",
			].join("\n"),
		);
		expect(md).toContain("### Options");
		expect(md).toContain("Body text.");
		expect(md).not.toContain("<details");
		expect(md).not.toContain("<summary");
	});
});

describe("readDocsMarkdown", () => {
	test("ends a page with its agent notes then the shared setup", async () => {
		const md = (await readDocsMarkdown("/docs/index")) ?? "";
		expect(md).not.toContain("export const agent");
		expect(md.indexOf("## Notes for agents")).toBeGreaterThan(0);
		expect(md.indexOf("## Setup")).toBeGreaterThan(
			md.indexOf("## Notes for agents"),
		);
	});
});

describe("readAllDocsMarkdown", () => {
	test("includes the shared setup section exactly once", async () => {
		const all = await readAllDocsMarkdown();
		expect(all.match(/^## Setup$/gm)?.length).toBe(1);
	});
});

describe("headingsFromMdx", () => {
	test("slugs headings like rehype-slug, repeats get suffixes, fences are skipped", () => {
		const source = [
			"# Title",
			"## Reorgs",
			"```sh",
			"## not a heading",
			"```",
			"### `consume()` basics",
			"## Reorgs",
			"## Notes for agents",
		].join("\n");
		const out = headingsFromMdx("/docs/x", source);
		expect(out.map((h) => h.anchor)).toEqual([
			"reorgs",
			"consume-basics",
			"reorgs-1",
		]);
		expect(out.map((h) => h.title)).toEqual([
			"Reorgs",
			"consume() basics",
			"Reorgs",
		]);
	});

	test("details rows use their authored id", () => {
		const source = [
			'<details id="cost-and-history">',
			"<summary>Cost and history</summary>",
			"</details>",
		].join("\n");
		expect(headingsFromMdx("/docs/x", source)).toEqual([
			{
				href: "/docs/x",
				anchor: "cost-and-history",
				title: "Cost and history",
				level: 3,
			},
		]);
	});
});

describe("docsSearchDocs", () => {
	test("covers exactly the search pool, with prose-only bodies", async () => {
		const docs = await docsSearchDocs();
		const pool = docsSearchPool(
			await docsHeadingIndex(),
			apiNav,
			docsPhrasings,
		);
		expect(docs.map((d) => d.id)).toEqual(pool.map((p) => p.id));
		expect(new Set(docs.map((d) => d.kind))).toEqual(
			new Set(["page", "section", "endpoint"]),
		);
		for (const d of docs) {
			expect(d.body).not.toContain("```");
			expect(d.body).not.toContain("export const");
			expect(d.body.length).toBeLessThanOrEqual(400);
			if (d.kind === "endpoint") expect(d.body).toBe("");
		}
		expect(
			docs.filter((d) => d.kind === "section" && d.body).length,
		).toBeGreaterThan(50);
	});
});

describe("sectionsFromMdx", () => {
	test("summary is the first prose sentence, past fences, links and ticks stripped", () => {
		const source = [
			"# Title",
			"",
			"Lede sentence with [a link](/docs/x). Second sentence.",
			"",
			"## Reorgs",
			"",
			"```sh",
			"echo no",
			"```",
			"",
			"A `fork` rolls rows back. More text.",
			"",
			'<details id="row">',
			"<summary>Row</summary>",
			"",
			"| a | b |",
			"| - | - |",
			"",
			"Row body here.",
			"</details>",
		].join("\n");
		const out = sectionsFromMdx("/docs/x", source);
		expect(out.lede).toBe("Lede sentence with a link.");
		expect(out.sections.map((s) => s.summary)).toEqual([
			"A fork rolls rows back.",
			"Row body here.",
		]);
	});

	test("a trailing metadata export never becomes the last section's summary", () => {
		const source = [
			"## Last",
			"",
			"| a | b |",
			"",
			"export const metadata = {",
			'  title: "Page title",',
			"};",
		].join("\n");
		expect(sectionsFromMdx("/docs/x", source).sections[0].summary).toBe("");
	});

	test("caps long summaries at 160 chars", () => {
		const long = `## Big\n\n${"word ".repeat(80)}end.`;
		const [s] = sectionsFromMdx("/docs/x", long).sections;
		expect(s.summary.length).toBeLessThanOrEqual(160);
		expect(s.summary.endsWith("…")).toBe(true);
	});
});

describe("docsSectionList", () => {
	test("every section is a heading-index target with a short fence-free summary", async () => {
		const list = await docsSectionList();
		const index = new Set(
			(await docsHeadingIndex()).map((h) => `${h.href}#${h.anchor}`),
		);
		expect(list.sections.length).toBe(index.size);
		for (const s of list.sections) {
			expect(index.has(`${s.href}#${s.anchor}`)).toBe(true);
			expect(s.summary.length).toBeLessThanOrEqual(160);
			expect(s.summary).not.toContain("`");
		}
		expect(list.pages.length).toBeGreaterThan(10);
		expect(JSON.stringify(list).length).toBeLessThan(120_000);
	});

	test("summaries stay off the heading index shipped to every page", async () => {
		const [first] = await docsHeadingIndex();
		expect("summary" in first).toBe(false);
	});
});

describe("docsHeadingIndex", () => {
	test("covers the Index page, skips generated pages and agent notes, no duplicate targets", async () => {
		const index = await docsHeadingIndex();
		expect(index.some((h) => h.href === "/docs/index")).toBe(true);
		expect(index.some((h) => h.href === "/docs/api-reference")).toBe(false);
		expect(index.some((h) => /^notes for agents$/i.test(h.title))).toBe(false);
		const keys = index.map((h) => `${h.href}#${h.anchor}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
