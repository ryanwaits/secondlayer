import { afterEach, describe, expect, test } from "bun:test";
import {
	FUSED_GAP,
	cachedNearest,
	fuse,
	fusedSure,
	reorder,
	requestNearest,
	shouldFind,
} from "./docs-find";

describe("shouldFind", () => {
	test("needs an unsure text search and enough words or characters", () => {
		expect(shouldFind("why are my rows doubled", false)).toBe(true);
		expect(shouldFind("rollbackbehaviour", false)).toBe(true);
		expect(shouldFind("reorg", false)).toBe(false);
		expect(shouldFind("two words", false)).toBe(false);
		expect(shouldFind("why are my rows doubled", true)).toBe(false);
	});

	test("stays under the longest query the API accepts", () => {
		expect(shouldFind("a ".repeat(100).trim(), false)).toBe(true);
		expect(shouldFind("a ".repeat(101).trim(), false)).toBe(false);
	});
});

describe("fuse", () => {
	test("blends the two signals evenly over the union", () => {
		const out = fuse(
			[
				{ id: "a", score: 10 },
				{ id: "b", score: 2 },
			],
			[
				{ id: "b", cos: 0.9 },
				{ id: "c", cos: 0.1 },
			],
		);
		// a: strong text, no cosine. b: weak text, strong cosine. c: nothing but weak cosine.
		expect(out.map((f) => f.id)).toEqual(["b", "a", "c"]);
		const sum = out.reduce((s, f) => s + f.score, 0);
		expect(sum).toBeCloseTo(0, 9);
	});

	test("a section missing from one list scores that signal's minimum", () => {
		const out = fuse(
			[
				{ id: "a", score: 4 },
				{ id: "b", score: 1 },
			],
			[
				{ id: "c", cos: 0.5 },
				{ id: "d", cos: 0.1 },
			],
		);
		const z = new Map(out.map((f) => [f.id, f.score]));
		// a, b have no cosine: both sit at the cosine floor (d's), so a beats b on text.
		expect(z.get("a")).toBeGreaterThan(z.get("b") as number);
		// c, d have no text score: both sit at the text floor (b's), so c beats d on cosine.
		expect(z.get("c")).toBeGreaterThan(z.get("d") as number);
		// b is at the floor of both signals, like d.
		expect(z.get("b")).toBeCloseTo(z.get("d") as number, 9);
	});

	test("one result, or identical scores, cannot divide by zero", () => {
		expect(fuse([{ id: "a", score: 3 }], [])).toEqual([{ id: "a", score: 0 }]);
		const flat = fuse(
			[
				{ id: "a", score: 1 },
				{ id: "b", score: 1 },
			],
			[
				{ id: "a", cos: 0.4 },
				{ id: "b", cos: 0.4 },
			],
		);
		expect(flat.every((f) => Number.isFinite(f.score))).toBe(true);
	});
});

describe("fusedSure", () => {
	test("needs the lead to clear the runner-up by the gap", () => {
		expect(fusedSure([{ score: 2 + FUSED_GAP + 0.001 }, { score: 2 }])).toBe(
			true,
		);
		expect(fusedSure([{ score: 2 + FUSED_GAP - 0.01 }, { score: 2 }])).toBe(
			false,
		);
		expect(fusedSure([{ score: 1 }])).toBe(true);
		expect(fusedSure([])).toBe(false);
	});
});

describe("reorder", () => {
	const rows = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));
	const items = new Map(rows.map((r) => [r.id, r]));
	const fused = ["e", "d", "c", "b", "a", "f"].map((id, i) => ({
		id,
		score: 10 - i,
	}));
	const ids = (list: { id: string }[]) => list.map((r) => r.id);

	test("with nobody on a row, shows the fused top rows", () => {
		expect(
			ids(
				reorder({
					fused,
					items,
					shown: rows.slice(0, 5),
					pinned: null,
					max: 5,
				}),
			),
		).toEqual(["e", "d", "c", "b", "a"]);
	});

	test("the row the reader is on keeps its row and slot while the rest re-sort", () => {
		expect(
			ids(
				reorder({
					fused,
					items,
					shown: rows.slice(0, 5),
					pinned: { id: "b", index: 1 },
					max: 5,
				}),
			),
		).toEqual(["e", "b", "d", "c", "a"]);
	});

	test("a pinned row the fusion dropped is kept, and the list never grows", () => {
		const out = reorder({
			fused: fused.filter((f) => f.id !== "a"),
			items,
			shown: rows.slice(0, 5),
			pinned: { id: "a", index: 4 },
			max: 5,
		});
		expect(ids(out)).toEqual(["e", "d", "c", "b", "a"]);
		expect(out).toHaveLength(5);
	});

	test("cosine-only sections that are not in the pool are skipped, never invented", () => {
		const out = reorder({
			fused: [{ id: "ghost", score: 9 }, ...fused],
			items,
			shown: rows.slice(0, 5),
			pinned: null,
			max: 3,
		});
		expect(ids(out)).toEqual(["e", "d", "c"]);
	});
});

describe("requestNearest", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});
	const fakeFetch = (impl: (url: string, init: RequestInit) => Response) => {
		const calls: { url: string; init: RequestInit }[] = [];
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return impl(url, init);
		}) as unknown as typeof fetch;
		return calls;
	};

	test("posts the trimmed query without credentials and remembers the answer by normalized text", async () => {
		const calls = fakeFetch(() =>
			Response.json({ results: [{ id: "docs:/docs/streams", cos: 0.8 }] }),
		);
		const out = await requestNearest(
			"  Why are Rows  doubled ",
			new AbortController().signal,
		);
		expect(out).toEqual([{ id: "docs:/docs/streams", cos: 0.8 }]);
		expect(calls[0].url).toEndWith("/api/public/docs-find");
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			q: "Why are Rows  doubled",
		});
		expect(calls[0].init.credentials).toBe("omit");
		expect(cachedNearest("why are rows doubled")).toEqual(out);
		expect(cachedNearest("never asked this")).toBeUndefined();
	});

	test("errors and 429 reject and are not cached", async () => {
		fakeFetch(() => new Response("slow down", { status: 429 }));
		await expect(
			requestNearest("rate limited query", new AbortController().signal),
		).rejects.toThrow();
		expect(cachedNearest("rate limited query")).toBeUndefined();
	});

	test("malformed entries are dropped", async () => {
		fakeFetch(() =>
			Response.json({
				results: [{ id: "docs:/docs/a", cos: 0.5 }, { id: 3 }, null, "x"],
			}),
		);
		expect(
			await requestNearest("malformed entries", new AbortController().signal),
		).toEqual([{ id: "docs:/docs/a", cos: 0.5 }]);
	});
});
