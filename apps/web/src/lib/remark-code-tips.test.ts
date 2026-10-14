import { describe, expect, test } from "bun:test";
import remarkCodeTips, { isGuide, routeOf } from "./remark-code-tips.mjs";

type Node = {
	type: string;
	[key: string]: unknown;
};

const code = (lang: string, value: string): Node => ({
	type: "code",
	lang,
	value,
});
const h2 = (): Node => ({ type: "heading", depth: 2, children: [] });
const tabs = (...fences: Node[]): Node => ({
	type: "mdxJsxFlowElement",
	name: "CodeTabs",
	children: fences,
});

/** What each fence ends up carrying, in order. */
function tipsOf(
	children: Node[],
	path = "/x/src/app/(www)/docs/streams/page.mdx",
) {
	const tree = { type: "root", children };
	remarkCodeTips()(tree, { path });
	const out: (string | undefined)[] = [];
	const visit = (node: Node) => {
		if (node.type === "code")
			out.push(
				(node.data as { hProperties?: Record<string, string> } | undefined)
					?.hProperties?.["data-tips"],
			);
		for (const child of (node.children as Node[] | undefined) ?? [])
			visit(child);
	};
	visit(tree);
	return out;
}

describe("routes", () => {
	test("a page's route comes from its file", () => {
		expect(routeOf("/a/src/app/(www)/docs/streams/page.mdx")).toBe(
			"/docs/streams",
		);
		expect(routeOf("/a/src/app/(www)/docs/page.mdx")).toBe("/docs");
		expect(routeOf("/a/src/content/note.mdx")).toBeNull();
	});

	test("only hand-written guides are guides", () => {
		expect(isGuide("/docs/streams")).toBe(true);
		expect(isGuide("/docs/self-host")).toBe(true);
		for (const route of [
			"/docs",
			"/docs/changelog",
			"/docs/api-reference",
			"/docs/api/streams",
			"/docs/sdk-reference/streams",
			"/docs/subgraphs-reference",
			"/p/streams",
			"/verify",
		])
			expect(isGuide(route), route).toBe(false);
	});
});

describe("the page ledger", () => {
	test("a method and an endpoint tip; a type does not", () => {
		expect(
			tipsOf([
				h2(),
				code("ts", "await sl.streams.tip();\nlet a: StreamsBatch;"),
				code("sh", 'curl "$URL/v1/streams/events?limit=1"'),
			]),
		).toEqual(["sl.streams.tip", "/v1/streams/events"]);
	});

	test("a name tips on its first mention only", () => {
		expect(
			tipsOf([
				h2(),
				code("ts", "await sl.streams.tip();"),
				h2(),
				code("ts", "await sl.streams.tip();\nawait sl.streams.consume({});"),
			]),
		).toEqual(["sl.streams.tip", "sl.streams.consume"]);
	});

	test("a section takes two; the next section starts again", () => {
		expect(
			tipsOf([
				h2(),
				code(
					"ts",
					"sl.streams.tip();\nsl.streams.consume({});\nsl.streams.events.list();",
				),
				h2(),
				code("ts", "sl.streams.reorgs.list();\nsl.streams.canonical();"),
			]),
		).toEqual([
			"sl.streams.tip sl.streams.consume",
			"sl.streams.reorgs.list sl.streams.canonical",
		]);
	});

	test("a name past the cap has had its first mention", () => {
		expect(
			tipsOf([
				h2(),
				code(
					"ts",
					"sl.streams.tip();\nsl.streams.consume({});\nsl.streams.canonical();",
				),
				h2(),
				code("ts", "sl.streams.canonical();"),
			]),
		).toEqual(["sl.streams.tip sl.streams.consume", undefined]);
	});

	test("a tab group tips its first fence; the twins get none", () => {
		expect(
			tipsOf([
				h2(),
				tabs(
					code("ts", "await sl.streams.tip();"),
					code("sh", "curl $URL/v1/streams/tip"),
				),
			]),
		).toEqual(["sl.streams.tip", undefined]);
	});

	test("comments and strings are not mentions; annotation lines are skipped", () => {
		expect(
			tipsOf([
				h2(),
				code(
					"ts",
					[
						"// sl.streams.tip",
						'const a = "sl.streams.consume";',
						"// !callout[/x/] sl.streams.canonical",
						"sl.streams.reorgs.list();",
					].join("\n"),
				),
			]),
		).toEqual(["sl.streams.reorgs.list"]);
	});

	test("output and other languages carry nothing", () => {
		expect(
			tipsOf([h2(), code("text", "sl.streams.tip"), code("json", "{}")]),
		).toEqual([undefined, undefined]);
	});

	test("a page that is not a guide is untouched", () => {
		const fences = [h2(), code("ts", "sl.streams.tip();")];
		expect(
			tipsOf(fences, "/x/src/app/(www)/docs/sdk-reference/streams/page.mdx"),
		).toEqual([undefined]);
		expect(tipsOf(fences, "/x/src/app/(www)/p/streams/page.mdx")).toEqual([
			undefined,
		]);
	});
});
