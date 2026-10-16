import { afterEach, describe, expect, test } from "bun:test";
import {
	clearSubgraphsData,
	fetchRows,
	refreshDetail,
	refreshErrors,
	refreshHealth,
	refreshList,
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
