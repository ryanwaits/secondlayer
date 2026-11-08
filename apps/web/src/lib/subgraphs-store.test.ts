import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type SubgraphsSeed,
	clearSubgraphsData,
	detailSeed,
	fetchRecentRows,
	listSeed,
	refreshDetail,
	refreshErrors,
	refreshHealth,
	refreshList,
	refreshListAndHealth,
	refreshSource,
	subgraphsSnapshot,
	useSubgraphsCache,
} from "./subgraphs-store";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	clearSubgraphsData();
});

function stub(res: Response) {
	const urls: string[] = [];
	globalThis.fetch = (async (url: string) => {
		urls.push(String(url));
		return res.clone();
	}) as typeof fetch;
	return urls;
}

const json = (body: unknown, init?: ResponseInit) =>
	new Response(JSON.stringify(body), init);

describe("subgraphs store", () => {
	test("a 404 on the list is an empty list, not an error", async () => {
		stub(json({ error: "none" }, { status: 404 }));
		const res = await refreshList();
		expect(res).toEqual({ kind: "ok", data: [] });
		expect(subgraphsSnapshot().list?.data).toEqual([]);
	});

	test("an ok list is cached", async () => {
		stub(json({ data: [{ name: "sbtc-deposits" }] }));
		await refreshList();
		expect(subgraphsSnapshot().list?.data[0]?.name).toBe("sbtc-deposits");
	});

	test("a starting stack keeps Retry-After and leaves the cache alone", async () => {
		stub(json({ data: [{ name: "sbtc-deposits" }] }));
		await refreshList();
		stub(
			json(
				{ error: "starting" },
				{ status: 503, headers: { "Retry-After": "7" } },
			),
		);
		const res = await refreshList();
		expect(res).toEqual({ kind: "starting", retryAfter: 7 });
		expect(subgraphsSnapshot().list?.data[0]?.name).toBe("sbtc-deposits");
	});

	test("a 404 on a detail is not_found and writes nothing", async () => {
		stub(json({ error: "x" }, { status: 404 }));
		const res = await refreshDetail("gone");
		expect(res.kind).toBe("not_found");
		expect(subgraphsSnapshot().detail.gone).toBeUndefined();
	});

	test("detail, health and errors go to their proxy paths", async () => {
		const urls = stub(json({ data: [], hours: [], errors24h: 0 }));
		await refreshDetail("vault-events");
		await refreshHealth("vault-events");
		await refreshErrors("vault-events");
		expect(urls).toEqual([
			"/api/subgraphs/vault-events",
			"/api/subgraphs/vault-events/health?hours=24",
			"/api/subgraphs/vault-events/errors?limit=20",
		]);
		expect(subgraphsSnapshot().errors["vault-events"]?.data).toEqual([]);
	});

	test("the source is cached for the page", async () => {
		const urls = stub(
			json({
				name: "vault-events",
				version: "1.0.0",
				sourceCode: "export default {}",
				readOnly: false,
				updatedAt: "2026-11-03T00:00:00Z",
			}),
		);
		const res = await refreshSource("vault-events");
		expect(res.kind).toBe("ok");
		expect(urls[0]).toBe("/api/subgraphs/vault-events/source");
		expect(subgraphsSnapshot().source["vault-events"]?.data.sourceCode).toBe(
			"export default {}",
		);
	});

	test("recent rows are one read of the recent path, not cached", async () => {
		const urls = stub(json({ data: [] }));
		const res = await fetchRecentRows("vault-events");
		expect(res.kind).toBe("ok");
		expect(urls).toEqual(["/api/subgraphs/vault-events/recent"]);
	});
});

describe("a subgraph that goes missing", () => {
	test("a 404 after the list had it drops it and marks it deleted", async () => {
		stub(json({ data: [{ name: "bns-gone" }, { name: "sbtc-deposits" }] }));
		await refreshList();
		stub(json({ error: "not found" }, { status: 404 }));
		await refreshDetail("bns-gone");
		const cache = subgraphsSnapshot();
		expect(cache.missing["bns-gone"]).toBe(true);
		expect(cache.list?.data.map((s) => s.name)).toEqual(["sbtc-deposits"]);
	});

	test("a 404 for a name this cache never had is missing, not deleted", async () => {
		stub(json({ error: "not found" }, { status: 404 }));
		await refreshDetail("bns-typo");
		expect(subgraphsSnapshot().missing["bns-typo"]).toBe(false);
	});
});

describe("sessionStorage", () => {
	test("refreshing the list saves nothing for a reload", async () => {
		const saved = new Map<string, string>();
		globalThis.sessionStorage = {
			setItem: (k: string, v: string) => void saved.set(k, v),
		} as unknown as Storage;
		globalThis.window = {} as Window & typeof globalThis;
		try {
			stub(json({ data: [{ name: "sbtc-deposits" }] }));
			await refreshList();
			expect(subgraphsSnapshot().list?.data[0]?.name).toBe("sbtc-deposits");
			expect(saved.size).toBe(0);
		} finally {
			// @ts-expect-error restoring the bare test environment
			globalThis.sessionStorage = undefined;
			// @ts-expect-error restoring the bare test environment
			globalThis.window = undefined;
		}
	});
});

describe("server seed", () => {
	const hours = [
		{ hour: "h", lagBlocks: 0, rowsWritten: 4, errors: 0, eventsHandled: 4 },
	];
	const list = {
		kind: "ok",
		data: [{ name: "a", health: { hours, errors24h: 0 } }, { name: "b" }],
	} as unknown as Parameters<typeof listSeed>[0];

	function Probe({ seed }: { seed: SubgraphsSeed }) {
		const cache = useSubgraphsCache(seed);
		return createElement(
			"p",
			null,
			`${cache.list?.data.length ?? "none"}:${Object.keys(cache.health).join(",")}`,
		);
	}

	test("listSeed carries the list and the health that came with it", () => {
		const seed = listSeed(list);
		expect(seed.list?.data.length).toBe(2);
		expect(Object.keys(seed.health ?? {})).toEqual(["a"]);
	});

	test("a failed read seeds nothing", () => {
		expect(listSeed({ kind: "asleep" })).toEqual({});
	});

	test("detailSeed keeps only the reads that came back ok, and a 404 as missing", () => {
		const seed = detailSeed("a", {
			detail: { kind: "not_found" },
			health: { kind: "ok", data: { hours, errors24h: 0 } },
			errors: { kind: "ok", data: [] },
			source: { kind: "starting", retryAfter: 5 },
		});
		expect(Object.keys(seed).sort()).toEqual(["errors", "health", "missing"]);
		expect(seed.missing).toEqual({ a: false });
	});

	test("the server render paints the seed and leaves the module cache empty", () => {
		const html = renderToStaticMarkup(
			createElement(Probe, { seed: listSeed(list) }),
		);
		expect(html).toContain("2:a");
		expect(subgraphsSnapshot().list).toBeUndefined();
	});

	test("a browser render starts the cache from the seed once", () => {
		globalThis.window = {} as Window & typeof globalThis;
		try {
			renderToStaticMarkup(createElement(Probe, { seed: listSeed(list) }));
			expect(subgraphsSnapshot().list?.data.length).toBe(2);
		} finally {
			// @ts-expect-error restoring the bare test environment
			globalThis.window = undefined;
		}
	});
});

describe("list with health", () => {
	const hours = [
		{ hour: "h", lagBlocks: 0, rowsWritten: 4, errors: 0, eventsHandled: 4 },
	];

	test("a list carrying health fills the health slice with no health request", async () => {
		const urls = stub(
			json({ data: [{ name: "a", health: { hours, errors24h: 0 } }] }),
		);
		const res = await refreshListAndHealth();
		expect(res.kind).toBe("ok");
		expect(urls).toEqual(["/api/subgraphs?health=168"]);
		expect(subgraphsSnapshot().health.a?.data.hours).toEqual(hours);
	});

	test("a list without health costs one health request per subgraph", async () => {
		const urls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			urls.push(String(url));
			return json(
				String(url).includes("/health")
					? { hours, errors24h: 0 }
					: { data: [{ name: "a" }, { name: "b" }] },
			);
		}) as typeof fetch;
		await refreshListAndHealth();
		expect(urls).toEqual([
			"/api/subgraphs?health=168",
			"/api/subgraphs/a/health?hours=168",
			"/api/subgraphs/b/health?hours=168",
		]);
		expect(Object.keys(subgraphsSnapshot().health).sort()).toEqual(["a", "b"]);
	});
});

describe("list dedupe", () => {
	test("a plain list and a list with health in flight together make two requests", async () => {
		const urls = stub(json({ data: [] }));
		await Promise.all([refreshList(), refreshList({ health: 24 })]);
		expect(urls.sort()).toEqual(["/api/subgraphs", "/api/subgraphs?health=24"]);
	});
});

describe("a read that outlives sign-out", () => {
	test("does not refill the cache for the next account", async () => {
		const releases: ((r: Response) => void)[] = [];
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) => {
				releases.push(resolve);
			})) as unknown as typeof fetch;
		const pending = Promise.all([
			refreshList(),
			refreshDetail("old"),
			refreshHealth("old"),
			refreshErrors("old"),
			refreshSource("old"),
		]);
		clearSubgraphsData();
		for (const release of releases)
			release(json({ data: [{ name: "old-account-subgraph" }] }));
		await pending;
		const cache = subgraphsSnapshot();
		expect(cache.list).toBeUndefined();
		expect(cache.detail).toEqual({});
		expect(cache.health).toEqual({});
		expect(cache.errors).toEqual({});
		expect(cache.source).toEqual({});
	});
});
