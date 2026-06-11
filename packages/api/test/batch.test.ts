import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error.ts";
import { BATCH_MAX_ITEMS, createBatchRouter } from "../src/routes/batch.ts";

function buildApp() {
	const inner = new Hono();
	inner.get("/v1/index/events", (c) =>
		c.json({ events: [], echo: c.req.query("event_type") ?? null }),
	);
	inner.get("/v1/index/secure", (c) =>
		c.json({ auth: c.req.header("authorization") ?? null }),
	);
	inner.get("/v1/index/boom", (c) => c.json({ error: "nope" }, 503));

	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/v1/batch",
		createBatchRouter(async (path, init) => inner.request(path, init)),
	);
	return app;
}

describe("POST /v1/batch", () => {
	test("runs items concurrently, preserves order, mixes statuses", async () => {
		const res = await buildApp().request("/v1/batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				requests: [
					{ path: "/v1/index/events", params: { event_type: "ft_transfer" } },
					{ path: "/v1/index/boom" },
					{ path: "/api/admin/secrets" },
				],
			}),
		});
		expect(res.status).toBe(200);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const body = (await res.json()) as any;
		expect(body.results).toHaveLength(3);
		expect(body.results[0].status).toBe(200);
		expect(body.results[0].body.echo).toBe("ft_transfer");
		expect(body.results[1].status).toBe(503);
		expect(body.results[2].status).toBe(400); // allowlist rejects /api/*
	});

	test("forwards credentials to every item", async () => {
		const res = await buildApp().request("/v1/batch", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer sk-sl_test",
			},
			body: JSON.stringify({ requests: [{ path: "/v1/index/secure" }] }),
		});
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const body = (await res.json()) as any;
		expect(body.results[0].body.auth).toBe("Bearer sk-sl_test");
	});

	test("rejects oversized batches and empty bodies", async () => {
		const app = buildApp();
		const too = await app.request("/v1/batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				requests: Array.from({ length: BATCH_MAX_ITEMS + 1 }, () => ({
					path: "/v1/index/events",
				})),
			}),
		});
		expect(too.status).toBe(400);
		const empty = await app.request("/v1/batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(empty.status).toBe(400);
	});
});
