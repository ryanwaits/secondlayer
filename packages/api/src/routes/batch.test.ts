import { describe, expect, test } from "bun:test";
import {
	createBatchRouter,
	isStreamingPath,
	normalizeBatchPath,
} from "./batch.ts";

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

	test("a stream that never ends can't be a batch item", () => {
		for (const raw of [
			"/v1/streams/events/stream",
			"/v1/streams/events/stream?chain=bitcoin",
			"/v1/streams/events/stream/",
			"/v1/subgraphs/my-subgraph/transfers/stream",
		]) {
			expect(isStreamingPath(new URL(raw, "http://x").pathname), raw).toBe(
				true,
			);
			expect(normalizeBatchPath(raw), raw).toBeNull();
		}
		expect(isStreamingPath("/v1/streams/events")).toBe(false);
		expect(isStreamingPath("/v1/streams/events/0xabc")).toBe(false);
	});

	test("a batch holding a stream refuses that item with 400 and never dispatches it", async () => {
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
					{ path: "/v1/streams/events/stream" },
					{ path: "/v1/streams/tip" },
				],
			}),
		});
		const body = (await res.json()) as { results: { status: number }[] };
		expect(body.results.map((r) => r.status)).toEqual([400, 200]);
		expect(seen).toEqual(["/v1/streams/tip"]);
	});

	test("each item carries the batch request's abort signal", async () => {
		const signals: (AbortSignal | undefined)[] = [];
		const router = createBatchRouter(async (_path, init) => {
			signals.push(init.signal);
			return Response.json({ ok: true });
		});
		const controller = new AbortController();
		await router.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ requests: [{ path: "/v1/streams/tip" }] }),
			signal: controller.signal,
		});
		expect(signals).toHaveLength(1);
		controller.abort();
		expect(signals[0]?.aborted).toBe(true);
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
