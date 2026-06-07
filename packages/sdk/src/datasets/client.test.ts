import { afterEach, describe, expect, mock, test } from "bun:test";
import { Datasets } from "./client.ts";

const BASE_URL = "http://localhost:3800";
const originalFetch = globalThis.fetch;

const CATALOG = {
	families: [
		{
			family: "stx-transfers",
			path: "/v1/datasets/stx-transfers",
			row_key: "events",
			filters: ["limit", "cursor"],
		},
		{
			family: "sbtc-events",
			path: "/v1/datasets/sbtc/events",
			row_key: "events",
			filters: ["limit", "cursor"],
		},
		{
			family: "bns-resolve",
			path: "/v1/datasets/bns/resolve",
			row_key: "name",
			filters: ["fqn"],
		},
	],
};

/** Mock fetch that records every requested URL and routes by path. */
function mockRoutes(): { urls: string[] } {
	const urls: string[] = [];
	globalThis.fetch = mock((input: string | URL | Request) => {
		const url = typeof input === "string" ? input : input.toString();
		urls.push(url);
		const path = url.slice(BASE_URL.length);
		let body: unknown = {};
		if (path === "/v1/datasets") body = CATALOG;
		else if (path.startsWith("/v1/datasets/stx-transfers"))
			body = {
				events: [{ a: 1 }],
				next_cursor: "c1",
				tip: { block_height: 9 },
			};
		else if (path.startsWith("/v1/datasets/sbtc/events"))
			body = { events: [{ s: 1 }], next_cursor: null };
		else if (path.startsWith("/v1/datasets/bns/resolve"))
			body = { name: { fqn: "alice.btc", owner: "SP..." } };
		return Promise.resolve({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => Promise.resolve(body),
			text: () => Promise.resolve(JSON.stringify(body)),
		} as Response);
	}) as unknown as typeof fetch;
	return { urls };
}

describe("Datasets.get", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("cursor slug uses the network-free fast path (no catalog fetch)", async () => {
		const { urls } = mockRoutes();
		const client = new Datasets({ baseUrl: BASE_URL });
		const env = await client.get("stx-transfers", { limit: 10 });
		expect(env.rows).toEqual([{ a: 1 }]);
		expect(env.next_cursor).toBe("c1");
		expect(env.tip).toEqual({ block_height: 9 });
		// Catalog endpoint must NOT have been hit for a known cursor slug.
		expect(urls.some((u) => u.endsWith("/v1/datasets"))).toBe(false);
	});

	test("bespoke single-object dataset resolves via the catalog → 0-or-1 rows", async () => {
		const { urls } = mockRoutes();
		const client = new Datasets({ baseUrl: BASE_URL });
		const env = await client.get("bns-resolve", { fqn: "alice.btc" });
		expect(env.rows).toEqual([{ fqn: "alice.btc", owner: "SP..." }]);
		expect(env.next_cursor).toBeNull();
		expect(urls.some((u) => u.endsWith("/v1/datasets"))).toBe(true);
	});

	test("accepts the path (slash) slug form for a cursor dataset not in the static map", async () => {
		mockRoutes();
		const client = new Datasets({ baseUrl: BASE_URL });
		const env = await client.get("sbtc/events");
		expect(env.rows).toEqual([{ s: 1 }]);
	});

	test("caches the catalog across calls (single fetch)", async () => {
		const { urls } = mockRoutes();
		const client = new Datasets({ baseUrl: BASE_URL });
		await client.get("bns-resolve", { fqn: "a.btc" });
		await client.get("sbtc/events");
		expect(urls.filter((u) => u.endsWith("/v1/datasets")).length).toBe(1);
	});

	test("throws for an unknown slug, listing available families", async () => {
		mockRoutes();
		const client = new Datasets({ baseUrl: BASE_URL });
		await expect(client.get("does-not-exist")).rejects.toThrow(
			/unknown dataset.*stx-transfers/s,
		);
	});
});
