import { describe, expect, test } from "bun:test";
import remarkDocsLinks from "./remark-docs-links.mjs";

type Node = { type: string; [key: string]: unknown };

const link = (url: string): Node => ({ type: "link", url, children: [] });
const guide = "/x/src/app/(www)/docs/subgraphs/page.mdx";

/** The tags each link ends up with, in order. */
function tagsOf(urls: string[], path = guide, wrap?: (l: Node) => Node) {
	const links = urls.map(link);
	const tree = {
		type: "root",
		children: links.map((l) => ({
			type: "paragraph",
			children: [wrap ? wrap(l) : l],
		})),
	};
	remarkDocsLinks()(tree, { path });
	return links.map((l): (string | undefined)[] | null => {
		const props = (
			l.data as { hProperties?: Record<string, string> } | undefined
		)?.hProperties;
		return props ? [props["data-link"], props["data-peek-kind"]] : null;
	});
}

describe("guide links", () => {
	test("a link that scrolls this page is a jump", () => {
		expect(
			tagsOf(["#handler-context", "/docs/subgraphs#handler-context"]),
		).toEqual([
			["jump", undefined],
			["jump", undefined],
		]);
	});

	test("a link to another docs page is a peek, by what it names", () => {
		expect(
			tagsOf([
				"/docs/streams#cursors",
				"/docs/index",
				"/docs/api/subgraphs#list-subgraph-rows",
			]),
		).toEqual([
			["peek", "section"],
			["peek", "page"],
			["peek", "api"],
		]);
	});

	test("external, hover, focus and tip links stay untagged", () => {
		expect(
			tagsOf([
				"https://example.com",
				"hover:client",
				"focus:client",
				"tip",
				"#",
			]),
		).toEqual([null, null, null, null, null]);
	});

	test("a link inside a heading stays untagged", () => {
		expect(
			tagsOf(["#x", "/docs/streams"], guide, (l) => ({
				type: "heading",
				depth: 2,
				children: [l],
			})),
		).toEqual([null, null]);
	});
});

describe("pages that are not guides", () => {
	test.each([
		"/x/src/app/(www)/blog/(post)/hello/page.mdx",
		"/x/src/app/(www)/docs/changelog/page.mdx",
		"/x/src/app/(www)/docs/api/subgraphs/page.mdx",
		"/x/src/app/(www)/docs/page.mdx",
	])("%s tags nothing", (path) => {
		expect(tagsOf(["#x", "/docs/streams#y"], path)).toEqual([null, null]);
	});
});
