import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { _resetRateLimits, rateLimit } from "./rate-limit.ts";

mock.module("@secondlayer/shared/errors", () => ({
	RateLimitError: class RateLimitError extends Error {
		code = "RATE_LIMIT_ERROR";
	},
}));

function createApp(limit = 120) {
	const app = new Hono();

	// Simulate auth middleware setting apiKey
	app.use("/*", async (c, next) => {
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		(c as any).set("apiKey", { key_hash: "test-hash", rate_limit: limit });
		await next();
	});
	app.use("/*", rateLimit());
	app.get("/test", (c) => c.json({ ok: true }));

	// Error handler to catch RateLimitError
	app.onError((err, c) => {
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		if ((err as any).code === "RATE_LIMIT_ERROR") {
			return c.json({ error: err.message }, 429);
		}
		return c.json({ error: "Internal error" }, 500);
	});

	return app;
}

describe("rateLimit middleware", () => {
	beforeEach(() => {
		_resetRateLimits();
	});

	test("120 requests pass, 121st gets 429", async () => {
		const app = createApp(120);

		for (let i = 0; i < 120; i++) {
			const res = await app.request("/test");
			expect(res.status).toBe(200);
		}

		const res = await app.request("/test");
		expect(res.status).toBe(429);
		expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
		expect(res.headers.get("X-RateLimit-Limit")).toBe("120");
		expect(res.headers.get("Retry-After")).toBeTruthy();
	});
});
