import { describe, expect, test } from "bun:test";
import { docsNavPages } from "@/app/(www)/docs/nav";
import { SITE, markdownPath } from "./docs-agent";
import { llmsTxt } from "./llms-txt";

describe("llmsTxt", () => {
	const text = llmsTxt();

	test("lists a markdown link for every sidebar page", () => {
		for (const page of docsNavPages()) {
			expect(text).toContain(
				`- [${page.title}](${SITE}${markdownPath(page.href)}) (${page.group})`,
			);
		}
	});

	test("links the introduction's markdown twin", () => {
		expect(text).toContain("https://secondlayer.tools/docs/introduction.md");
	});

	test("does not mention the removed agent mode", () => {
		expect(text).not.toContain("mode=agent");
	});
});
