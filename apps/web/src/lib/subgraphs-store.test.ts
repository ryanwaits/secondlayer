import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	clearSubgraphsData,
	fetchRows,
	prefetchFirstPage,
	refreshDetail,
	refreshErrors,
	refreshHealth,
	refreshList,
	refreshListAndHealth,
	rememberFirstPage,
	streamUrl,
	subgraphsSnapshot,
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

	test("rows are fetched through the rows path and not cached", async () => {
		const urls = stub(json({ rows: [], next_cursor: null }));
		const res = await fetchRows(
			"vault-events",
			"transfers",
			"_sort=a&_order=desc",
		);
		expect(res.kind).toBe("ok");
		expect(urls[0]).toBe(
			"/api/subgraphs/vault-events/rows/transfers?_sort=a&_order=desc",
		);
	});

	test("the stream url carries the filters", () => {
		expect(streamUrl("vault-events", "transfers", "kind=burn")).toBe(
			"/api/subgraphs/vault-events/rows/transfers/stream?kind=burn",
		);
		expect(streamUrl("vault-events", "transfers", "")).toBe(
			"/api/subgraphs/vault-events/rows/transfers/stream",
		);
	});
});

const storage = new Map<string, string>();

function installStorage() {
	storage.clear();
	globalThis.sessionStorage = {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => void storage.set(k, v),
		removeItem: (k: string) => void storage.delete(k),
		key: (i: number) => [...storage.keys()][i] ?? null,
		get length() {
			return storage.size;
		},
	} as unknown as Storage;
	globalThis.window = {} as Window & typeof globalThis;
}

function removeStorage() {
	// @ts-expect-error restoring the bare test environment
	globalThis.sessionStorage = undefined;
	// @ts-expect-error restoring the bare test environment
	globalThis.window = undefined;
}

function envelope(data: unknown): string {
	return JSON.stringify({ owner: null, savedAt: Date.now(), data });
}

describe("this tab's saved copy", () => {
	beforeEach(installStorage);
	afterEach(removeStorage);

	test("a successful list refresh is saved for a reload", async () => {
		stub(json({ data: [{ name: "sbtc-deposits" }] }));
		await refreshList();
		expect(storage.get("sl:dash:v1:subgraphs")).toContain("sbtc-deposits");
	});

	test("a reload reads the saved copy and clearing removes it", () => {
		clearSubgraphsData(); // resets the store as a fresh page load would
		storage.set(
			"sl:dash:v1:subgraphs",
			envelope({ list: { data: [{ name: "sbtc-deposits" }], at: 1 } }),
		);
		expect(subgraphsSnapshot().list?.data[0]?.name).toBe("sbtc-deposits");
		clearSubgraphsData();
		expect(storage.has("sl:dash:v1:subgraphs")).toBe(false);
	});
});

describe("first-page cache", () => {
	const page = { rows: [{ _id: 1, _block_height: 9 }], next_cursor: null };

	test("prefetching a first page stores its rows", async () => {
		stub(json(page));
		await prefetchFirstPage("a", "t", "_limit=50");
		expect(subgraphsSnapshot().firstPage["a/t"]?.data.rows).toEqual(page.rows);
	});

	test("remembering 21 pages keeps the newest 20", () => {
		for (let i = 0; i < 21; i++) rememberFirstPage(`s${i}`, "t", page);
		const keys = Object.keys(subgraphsSnapshot().firstPage);
		expect(keys).toHaveLength(20);
		expect(keys).toContain("s20/t");
	});

	test("signing out empties the remembered pages", () => {
		rememberFirstPage("a", "t", page);
		clearSubgraphsData();
		expect(subgraphsSnapshot().firstPage).toEqual({});
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
		expect(urls).toEqual(["/api/subgraphs?health=24"]);
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
			"/api/subgraphs?health=24",
			"/api/subgraphs/a/health?hours=24",
			"/api/subgraphs/b/health?hours=24",
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
