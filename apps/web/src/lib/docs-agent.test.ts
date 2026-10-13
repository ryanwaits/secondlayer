import { describe, expect, test } from "bun:test";
import { DOCS_NAV, docsNavPages } from "../app/(www)/docs/nav";
import { githubSourcePath, markdownPath } from "./docs-agent";

describe("docs agent paths", () => {
	test("the introduction's markdown twin is introduction.md", () => {
		expect(markdownPath("/docs")).toBe("/docs/introduction.md");
		expect(markdownPath("/docs/")).toBe("/docs/introduction.md");
	});

	test("the edit link's source path is the page's MDX file", () => {
		expect(githubSourcePath("/docs")).toBe("docs/page.mdx");
		expect(githubSourcePath("/docs/streams")).toBe("docs/streams/page.mdx");
	});

	test("every nav page has a source path and a markdown path", () => {
		for (const page of docsNavPages()) {
			expect(githubSourcePath(page.href)).toMatch(
				/^docs(\/.+)?\/page\.mdx$|^docs\/page\.mdx$/,
			);
			expect(markdownPath(page.href)).toMatch(/\.md$/);
		}
		expect(DOCS_NAV.length).toBeGreaterThan(0);
	});
});
