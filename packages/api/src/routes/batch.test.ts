import { describe, expect, test } from "bun:test";
import { createBatchRouter, normalizeBatchPath } from "./batch.ts";

describe("batch item paths", () => {
	test("a read path is dispatched as the URL parser resolves it, query kept", () => {
		expect(normalizeBatchPath("/v1/index/blocks")).toBe("/v1/index/blocks");
		expect(normalizeBatchPath("/v1/index/transactions?limit=5")).toBe(
			"/v1/index/transactions?limit=5",
		);
		expect(normalizeBatchPath("/v1/index/./blocks")).toBe("/v1/index/blocks");
		expect(normalizeBatchPath("/v1/streams/tip")).toBe("/v1/streams/tip");
	});

	test("dot segments, encoded or not, can't walk out of /v1", () => {
		for (const raw of [
			"/v1/index/../../api/keys",
			"/v1/../api/keys",
			"/v1/index/%2e%2e/%2e%2e/api/keys",
			"/v1/index/%2E%2E/%2E%2E/api/keys",
			"/v1/index/.%2e/.%2E/api/keys",
			"/v1/index/%252e%252e/%252e%252e/api/keys",
			"/v1/index/%2f..%2fapi/keys",
			"/v1/index/%5c..%5capi/keys",
			"/v1/index\\..\\..\\api\\keys",
			"//evil.example/v1/index/blocks",
			"https://evil.example/v1/index/blocks",
			"v1/index/blocks",
			"/api/keys",
			"/mcp",
		]) {
			expect(normalizeBatchPath(raw), raw).toBeNull();
		}
	});

	test("the router dispatches exactly the normalized path and refuses the rest", async () => {
		const seen: string[] = [];
		const router = createBatchRouter(async (path) => {
			seen.push(path);
			return Response.json({ ok: true });
		});
		const res = await router.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				requests: [
					{ path: "/v1/index/./blocks", params: { limit: 2 } },
					{ path: "/v1/index/%2e%2e/%2e%2e/api/keys" },
					{ path: "/v1/index/%252e%252e/%252e%252e/api/keys" },
					{ path: "/v1/../api/keys" },
				],
			}),
		});
		const body = (await res.json()) as { results: { status: number }[] };
		expect(body.results.map((r) => r.status)).toEqual([200, 400, 400, 400]);
		expect(seen).toEqual(["/v1/index/blocks?limit=2"]);
	});
});
