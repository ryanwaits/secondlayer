import { afterEach, describe, expect, test } from "bun:test";
import {
	type CommandItem,
	DOCS_ITEMS,
	docsHeadingItems,
} from "@/lib/command-center/items";
import type { ScoredItem } from "@/lib/command-center/search";
import {
	type FindMatch,
	cachedFind,
	isWeakSearch,
	matchItem,
	mergeFind,
	requestFind,
	shouldFind,
} from "./docs-find";

const POOL: CommandItem[] = [
	...DOCS_ITEMS,
	...docsHeadingItems(
		[
			{
				href: "/docs/streams",
				anchor: "reorg-behavior",
				title: "Reorg behavior",
			},
			{ href: "/docs/streams", anchor: "cursors", title: "Cursors" },
			{ href: "/docs/webhooks", anchor: "triggers", title: "Triggers" },
		],
		(href) => href,
	),
];
const BY_ID = new Map(POOL.map((i) => [i.id, i]));

const item = (anchor: string) =>
	BY_ID.get(`docs:/docs/streams#${anchor}`) as CommandItem;
const strong = (i: CommandItem): ScoredItem => ({
	item: i,
	score: 300,
	range: [0, 1],
});
const weak = (i: CommandItem): ScoredItem => ({
	item: i,
	score: 100,
	range: null,
});

const reorgs: FindMatch = {
	href: "/docs/streams",
	anchor: "reorg-behavior",
	title: "Reorg behavior",
	confidence: 0.9,
};

describe("shouldFind", () => {
	test("needs a weak local search and enough words or characters", () => {
		expect(shouldFind("why are my rows doubled", true)).toBe(true);
		expect(shouldFind("reorg", true)).toBe(false);
		expect(shouldFind("subgraphs?!", true)).toBe(false);
		expect(shouldFind("rollbackbehaviour", true)).toBe(true);
		expect(shouldFind("a b c", true)).toBe(true);
		expect(shouldFind("why are my rows doubled", false)).toBe(false);
	});

	test("stays under the longest query the API accepts", () => {
		expect(shouldFind("word ".repeat(41), true)).toBe(false);
	});
});

describe("isWeakSearch", () => {
	test("a label match is strong, a paraphrase with no label match is weak", () => {
		expect(isWeakSearch("reorg", POOL)).toBe(false);
		expect(isWeakSearch("cursors", POOL)).toBe(false);
		expect(isWeakSearch("why are my rows doubled after a fork", POOL)).toBe(
			true,
		);
	});
});

describe("matchItem", () => {
	test("resolves a section to its pool row and a page-only match to the page row", () => {
		expect(matchItem(reorgs, BY_ID)?.id).toBe(
			"docs:/docs/streams#reorg-behavior",
		);
		expect(
			matchItem(
				{ href: "/docs/streams", title: "Streams", confidence: 0.9 },
				BY_ID,
			)?.id,
		).toBe("docs:/docs/streams");
	});

	test("a match outside the pool is dropped, never invented", () => {
		expect(matchItem({ ...reorgs, anchor: "nope" }, BY_ID)).toBeNull();
	});
});

describe("mergeFind", () => {
	const local = [weak(item("cursors"))];
	const lead = item("reorg-behavior");

	test("no match leaves the text hits exactly as they were", () => {
		const out = mergeFind({
			hits: local,
			match: null,
			item: null,
			selectedId: null,
			max: 5,
		});
		expect(out.items.map((i) => i.id)).toEqual([item("cursors").id]);
		expect(out.selected).toBe(0);
	});

	test("a confident match leads and is the default row", () => {
		const out = mergeFind({
			hits: local,
			match: reorgs,
			item: lead,
			selectedId: null,
			max: 5,
		});
		expect(out.items.map((i) => i.id)).toEqual([lead.id, item("cursors").id]);
		expect(out.selected).toBe(0);
	});

	test("a fair match follows the strong text hits and precedes weak ones", () => {
		const hits = [
			strong(item("cursors")),
			weak(BY_ID.get("docs:/docs/webhooks#triggers") as CommandItem),
		];
		const out = mergeFind({
			hits,
			match: { ...reorgs, confidence: 0.6 },
			item: lead,
			selectedId: null,
			max: 5,
		});
		expect(out.items.map((i) => i.id)).toEqual([
			item("cursors").id,
			lead.id,
			"docs:/docs/webhooks#triggers",
		]);
	});

	test("a doubtful match changes nothing", () => {
		const out = mergeFind({
			hits: local,
			match: { ...reorgs, confidence: 0.49 },
			item: lead,
			selectedId: null,
			max: 5,
		});
		expect(out.items.map((i) => i.id)).toEqual([item("cursors").id]);
	});

	test("a match already among the hits appears once", () => {
		const out = mergeFind({
			hits: [weak(lead), weak(item("cursors"))],
			match: reorgs,
			item: lead,
			selectedId: null,
			max: 5,
		});
		expect(out.items.filter((i) => i.id === lead.id)).toHaveLength(1);
		expect(out.items[0].id).toBe(lead.id);
	});

	test("the row the reader arrowed onto keeps its identity when the list changes", () => {
		const out = mergeFind({
			hits: local,
			match: reorgs,
			item: lead,
			selectedId: item("cursors").id,
			max: 5,
		});
		expect(out.items[out.selected].id).toBe(item("cursors").id);
	});

	test("never grows past the row cap", () => {
		const many = POOL.slice(0, 8).map(weak);
		const out = mergeFind({
			hits: many,
			match: reorgs,
			item: lead,
			selectedId: null,
			max: 5,
		});
		expect(out.items).toHaveLength(5);
		expect(out.items[0].id).toBe(lead.id);
	});
});

describe("requestFind", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	test("posts the trimmed query without credentials and remembers the answer by normalized text", async () => {
		let call = null as { url: string; init: RequestInit } | null;
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			call = { url, init };
			return Response.json({ match: reorgs });
		}) as unknown as typeof fetch;
		const got = await requestFind(
			"  Why  are rows doubled ",
			new AbortController().signal,
		);
		expect(got).toEqual(reorgs);
		expect(call?.url.endsWith("/api/public/docs-find")).toBe(true);
		expect(call?.init.credentials).toBe("omit");
		expect(call?.init.body).toBe(
			JSON.stringify({ q: "Why  are rows doubled" }),
		);
		expect(cachedFind("why are rows   DOUBLED")).toEqual(reorgs);
	});

	test("a null answer is cached as asked-and-empty; errors and 429 are not cached and reject", async () => {
		globalThis.fetch = (async () =>
			Response.json({ match: null })) as unknown as typeof fetch;
		await requestFind("nothing here matches", new AbortController().signal);
		expect(cachedFind("nothing here matches")).toBeNull();

		globalThis.fetch = (async () =>
			new Response("slow down", { status: 429 })) as unknown as typeof fetch;
		await expect(
			requestFind("too many requests today", new AbortController().signal),
		).rejects.toThrow();
		expect(cachedFind("too many requests today")).toBeUndefined();
	});

	test("a malformed match is treated as no match", async () => {
		globalThis.fetch = (async () =>
			Response.json({ match: { href: 3 } })) as unknown as typeof fetch;
		expect(
			await requestFind("garbled answer here", new AbortController().signal),
		).toBeNull();
	});
});
