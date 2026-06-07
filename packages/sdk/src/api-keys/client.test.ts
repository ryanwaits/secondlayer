import { afterEach, describe, expect, mock, test } from "bun:test";
import { ApiKeys } from "./client.ts";

const BASE_URL = "http://localhost:3800";
const originalFetch = globalThis.fetch;

function recorder(body: unknown = {}) {
	const calls: Array<{ method: string; path: string }> = [];
	globalThis.fetch = mock(
		(input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({
				method: init?.method ?? "GET",
				path: url.slice(BASE_URL.length),
			});
			return Promise.resolve({
				ok: true,
				status: 200,
				headers: new Headers({ "content-type": "application/json" }),
				json: () => Promise.resolve(body),
				text: () => Promise.resolve(JSON.stringify(body)),
			} as Response);
		},
	) as unknown as typeof fetch;
	return calls;
}

describe("ApiKeys list/revoke", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("list → GET /api/keys, summaries carry no plaintext key", async () => {
		const calls = recorder({
			keys: [
				{
					id: "k1",
					prefix: "sk-sl_abc",
					name: "ci",
					status: "active",
					product: "streams",
					tier: "build",
					createdAt: "2026-06-07T00:00:00Z",
					lastUsedAt: null,
				},
			],
		});
		const { keys } = await new ApiKeys({ baseUrl: BASE_URL }).list();
		expect(calls).toEqual([{ method: "GET", path: "/api/keys" }]);
		expect(keys[0]).not.toHaveProperty("key");
		expect(keys[0]?.prefix).toBe("sk-sl_abc");
	});

	test("revoke → DELETE /api/keys/:id", async () => {
		const calls = recorder({ revoked: true, id: "k1" });
		const res = await new ApiKeys({ baseUrl: BASE_URL }).revoke("k1");
		expect(calls).toEqual([{ method: "DELETE", path: "/api/keys/k1" }]);
		expect(res).toEqual({ revoked: true, id: "k1" });
	});
});
