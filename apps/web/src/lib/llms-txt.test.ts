import { describe, expect, test } from "bun:test";
import { docsNavPages } from "@/app/(www)/docs/nav";
import { dataPath, liveDataTopics } from "./data-topics";
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

	test("lists every live protocol data page on the www host", () => {
		expect(text).toContain("## Protocol data");
		for (const topic of liveDataTopics())
			expect(text).toContain(`${SITE}${dataPath(topic)}`);
	});

	test("links the introduction's markdown twin", () => {
		expect(text).toContain(
			"https://www.secondlayer.tools/docs/introduction.md",
		);
	});

	test("links only the www host", () => {
		expect(text).not.toContain("https://secondlayer.tools");
	});

	test("lists the hosted OpenAPI spec", () => {
		expect(text).toContain(
			"Hosted OpenAPI: https://api.secondlayer.tools/v1/openapi.json",
		);
	});

	test("does not mention the removed agent mode", () => {
		expect(text).not.toContain("mode=agent");
	});
});
