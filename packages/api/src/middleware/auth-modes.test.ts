import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { instanceTokenAuth, shouldSkipInstanceAuth } from "./auth-modes.ts";
import { errorHandler } from "./error.ts";

describe("shouldSkipInstanceAuth", () => {
	test("skips health and public", () => {
		expect(shouldSkipInstanceAuth("/health")).toBe(true);
		expect(shouldSkipInstanceAuth("/public/status")).toBe(true);
		expect(shouldSkipInstanceAuth("/v1/index/events")).toBe(false);
	});
});

describe("instanceTokenAuth", () => {
	const prevToken = process.env.INSTANCE_TOKEN;
	const prevKey = process.env.API_KEY;

	afterEach(() => {
		if (prevToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = prevToken;
		if (prevKey === undefined) delete process.env.API_KEY;
		else process.env.API_KEY = prevKey;
	});

	function app() {
		const hono = new Hono();
		hono.onError(errorHandler);
		hono.use("*", instanceTokenAuth());
		hono.get("/health", (c) => c.json({ ok: true }));
		hono.get("/v1/ping", (c) => c.json({ ok: true }));
		return hono;
	}

	test("no token: every route is open", async () => {
		delete process.env.INSTANCE_TOKEN;
		delete process.env.API_KEY;
		const res = await app().request("/v1/ping");
		expect(res.status).toBe(200);
	});

	test("token set: health stays open, other routes need Bearer", async () => {
		process.env.INSTANCE_TOKEN = "secret";
		delete process.env.API_KEY;
		const h = app();
		expect((await h.request("/health")).status).toBe(200);
		expect((await h.request("/v1/ping")).status).toBe(401);
		expect(
			(
				await h.request("/v1/ping", {
					headers: { Authorization: "Bearer secret" },
				})
			).status,
		).toBe(200);
		expect(
			(
				await h.request("/v1/ping", {
					headers: { Authorization: "Bearer wrong" },
				})
			).status,
		).toBe(401);
	});
});
