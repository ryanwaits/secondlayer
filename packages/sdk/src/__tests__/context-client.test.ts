import { afterEach, describe, expect, test } from "bun:test";
import { SecondLayer } from "../index.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("SecondLayer.context()", () => {
	test("composes the orientation snapshot across surfaces", async () => {
		globalThis.fetch = (async (input, _init) => {
			const url = new URL(
				(input instanceof Request ? input.url : input.toString()).replace(
					/^(?!https?:)/,
					"https://api.secondlayer.tools",
				),
			);
			const p = url.pathname;
			if (p === "/api/accounts/me")
				return json({ email: "a@b.com", plan: "scale" });
			if (p === "/v1/streams/tip")
				return json({
					block_height: 100,
					block_hash: "0x1",
					burn_block_height: 50,
					lag_seconds: 1,
				});
			if (p === "/v1/index/canonical")
				return json({
					canonical: [],
					next_cursor: null,
					tip: { block_height: 99, lag_seconds: 2 },
				});
			if (p === "/api/subgraphs")
				return json({
					data: [
						{ name: "swaps", status: "reindexing", tables: [] },
						{ name: "pools", status: "running", tables: [] },
					],
				});
			if (p === "/api/subgraphs/swaps/operations")
				return json({
					operations: [
						{ id: "op-1", kind: "reindex", status: "running", progress: 0.4 },
					],
				});
			if (p === "/api/subscriptions")
				return json({
					data: [
						{ status: "active" },
						{ status: "active" },
						{ status: "paused" },
					],
				});
			if (p === "/api/projects")
				return json({
					projects: [
						{
							id: "p1",
							name: "My App",
							slug: "my-app",
							network: "mainnet",
							nodeRpc: null,
							settings: null,
							createdAt: "",
							updatedAt: "",
						},
					],
				});
			if (p === "/api/keys")
				return json({
					keys: [
						{
							id: "k1",
							prefix: "sk-sl_a",
							name: "ci",
							status: "active",
							product: "streams",
							tier: "build",
							createdAt: "",
							lastUsedAt: null,
						},
					],
				});
			throw new Error(`unexpected path ${p}`);
		}) as typeof fetch;

		const snap = await new SecondLayer({ apiKey: "sk-test" }).context();

		expect(snap.account).toEqual({ email: "a@b.com", plan: "scale" });
		expect(snap.streamsTip?.block_height).toBe(100);
		expect(snap.indexTip?.block_height).toBe(99);
		expect(snap.subscriptions).toEqual({
			count: 3,
			byStatus: { active: 2, paused: 1 },
		});
		// Projects/keys are mapped to compact, plaintext-free shapes.
		expect(snap.projects).toEqual([
			{ name: "My App", slug: "my-app", network: "mainnet" },
		]);
		expect(snap.apiKeys).toEqual([
			{ prefix: "sk-sl_a", name: "ci", status: "active", product: "streams" },
		]);
		// Only the reindexing subgraph is probed for an in-flight operation.
		expect(snap.activeOperations).toEqual([
			{
				subgraph: "swaps",
				operationId: "op-1",
				kind: "reindex",
				status: "running",
				progress: 0.4,
			},
		]);
	});

	test("degrades to null per field when a read fails", async () => {
		globalThis.fetch = (async (_input, _init) =>
			new Response("nope", { status: 401 })) as typeof fetch;
		const snap = await new SecondLayer().context();
		expect(snap.account).toBeNull();
		expect(snap.streamsTip).toBeNull();
		expect(snap.subgraphs).toBeNull();
		expect(snap.projects).toBeNull();
		expect(snap.apiKeys).toBeNull();
		expect(snap.activeOperations).toBeNull();
	});
});
