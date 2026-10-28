import { describe, expect, test } from "bun:test";
import { allEndpoints } from "@/app/(www)/docs/api-reference/spec";
import { docsNavPages } from "@/app/(www)/docs/nav";
import { GET as getLlmsApi } from "@/app/llms-api.txt/route";
import { GET as getLlmsFull } from "@/app/llms-full.txt/route";
import { dataPath, liveDataTopics } from "./data-topics";
import { SITE, markdownPath } from "./docs-agent";
import { endpointMarkdownUrl } from "./llms-api";
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

	test("points at the endpoint list and the guides file with sizes", () => {
		expect(text).toMatch(/\(~\d+ KB\): .*\/llms-api\.txt/);
		expect(text).toMatch(/\(~\d+ KB\): .*\/llms-full\.txt/);
	});
});

describe("llms-full.txt", () => {
	test("stays small enough for fetchers: guides only, under 300 KB", async () => {
		const body = await (await getLlmsFull()).text();
		expect(Buffer.byteLength(body)).toBeLessThan(300_000);
		expect(body).toContain("# Start / Introduction");
		expect(body).toContain("# Reference / REST conventions");
		expect(body).toContain("next_cursor");
		expect(body).not.toContain("SDK reference /");
		expect(body).not.toContain("# Reference / Changelog");
	});
});

describe("llms-api.txt", () => {
	test("lists every endpoint's markdown URL exactly once", async () => {
		const body = await (await getLlmsApi()).text();
		for (const e of allEndpoints()) {
			const url = endpointMarkdownUrl(e.anchor);
			expect(body.split(`${url}\n`).length - 1).toBe(1);
		}
		expect(body.match(/→ /g)?.length).toBe(allEndpoints().length);
	});

	test("every URL is on the www or api host", async () => {
		const body = await (await getLlmsApi()).text();
		for (const url of body.match(/https?:\/\/\S+/g) ?? []) {
			expect(
				url.startsWith("https://www.secondlayer.tools") ||
					url.startsWith("https://api.secondlayer.tools"),
			).toBe(true);
		}
	});
});
