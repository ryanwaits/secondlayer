import { describe, expect, test } from "bun:test";
import {
	type DocsSearchDoc,
	buildIndex,
	confident,
	search,
	tokenize,
} from "./docs-bm25";
import { docsSearchDocs } from "./docs-source";

function doc(id: string, over: Partial<DocsSearchDoc> = {}): DocsSearchDoc {
	return {
		id,
		href: id,
		label: id,
		sub: "",
		kind: "section",
		title: "",
		page: "",
		phrasings: [],
		body: "",
		...over,
	};
}

describe("tokenize", () => {
	test("lowercases, splits on non-alphanumerics, drops function words", () => {
		expect(tokenize("Why are my Rows doubled, after a fork?")).toEqual([
			"row",
			"doubl",
			"fork",
		]);
	});

	test("strips one suffix only while three characters remain", () => {
		expect(tokenize("reorgs")).toEqual(["reorg"]);
		expect(tokenize("bus")).toEqual(["bus"]);
		expect(tokenize("slowly")).toEqual(["slow"]);
		expect(tokenize("fix")).toEqual(["fix"]);
	});
});

describe("search", () => {
	const docs = [
		doc("body-only", { title: "Overview", body: "how webhooks are signed" }),
		doc("title-hit", { title: "Signed webhooks" }),
		doc("unrelated", { title: "Hardware", body: "disk and memory" }),
	];
	const index = buildIndex(docs);

	test("a title match outranks a body-only match", () => {
		const out = search(index, "signed webhooks", 3);
		expect(out.map((r) => r.id)).toEqual(["title-hit", "body-only"]);
	});

	test("docs sharing no query term are omitted", () => {
		expect(search(index, "purple elephant", 3)).toEqual([]);
	});

	test("an exact title outranks a prefix title outranks a stronger body match", () => {
		const tiered = buildIndex([
			doc("body", {
				title: "Overview",
				body: "reorg reorg reorg reorg reorg reorg",
			}),
			doc("prefix", { title: "Reorg rollback" }),
			doc("exact", { title: "Reorgs" }),
		]);
		const out = search(tiered, "reorg", 3);
		expect(out.map((r) => [r.id, r.tier])).toEqual([
			["exact", 2],
			["prefix", 1],
			["body", 0],
		]);
	});

	test("respects k", () => {
		expect(search(index, "webhooks", 1)).toHaveLength(1);
	});
});

describe("confident", () => {
	test("needs a positive top score", () => {
		expect(confident([])).toBe(false);
		expect(confident([{ score: 0 }])).toBe(false);
	});

	test("a lone result is confident", () => {
		expect(confident([{ score: 1 }])).toBe(true);
	});

	test("an exact title match is confident whatever the runner-up scores", () => {
		expect(confident([{ score: 1, tier: 2 }, { score: 1 }])).toBe(true);
		expect(confident([{ score: 1, tier: 1 }, { score: 1 }])).toBe(false);
	});

	test("top must beat the runner-up by 1.4x", () => {
		expect(confident([{ score: 1.4 }, { score: 1 }])).toBe(true);
		expect(confident([{ score: 1.39 }, { score: 1 }])).toBe(false);
	});
});

describe("on the real docs index", () => {
	test("typing a heading lands on it first", async () => {
		const index = buildIndex(await docsSearchDocs());
		const first = (q: string) => search(index, q, 5)[0].id;
		expect(first("reorg")).toBe("docs:/docs/index#reorgs");
		expect(first("webhooks")).toBe("docs:/docs/webhooks");
		expect(first("receiver down")).toBe("docs:/docs/webhooks#receiver-down");
	});

	test("one query ranks in under 5 ms", async () => {
		const index = buildIndex(await docsSearchDocs());
		search(index, "warm up", 5);
		const start = performance.now();
		const runs = 50;
		for (let i = 0; i < runs; i++)
			search(index, "resume where my consumer stopped", 5);
		expect((performance.now() - start) / runs).toBeLessThan(5);
	});
});
