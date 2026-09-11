import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { instanceTokenAuth } from "../../middleware/auth-modes.ts";
import { errorHandler } from "../../middleware/error.ts";
import subgraphsRouter from "../subgraphs.ts";

/**
 * Authed control-plane GET for print-validate skips. Not under `/v1`.
 * OSS requires INSTANCE_TOKEN when set (same gate as neighboring /api/subgraphs).
 */
describe("GET /api/subgraphs/:name/violations auth", () => {
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
		hono.use("/api/subgraphs/*", instanceTokenAuth());
		hono.route("/api/subgraphs", subgraphsRouter);
		return hono;
	}

	test("401 without instance token when INSTANCE_TOKEN is set", async () => {
		process.env.INSTANCE_TOKEN = "secret-token";
		delete process.env.API_KEY;
		const res = await app().request("/api/subgraphs/dex/violations");
		expect(res.status).toBe(401);
	});

	test("with Bearer token the route is reached (not 401 from auth)", async () => {
		process.env.INSTANCE_TOKEN = "secret-token";
		delete process.env.API_KEY;
		const res = await app().request("/api/subgraphs/dex/violations", {
			headers: { Authorization: "Bearer secret-token" },
		});
		// Auth passed — subgraph resolution or DB may 404/500, but never 401.
		expect(res.status).not.toBe(401);
	});
});
