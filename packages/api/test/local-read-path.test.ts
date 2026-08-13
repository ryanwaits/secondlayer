import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error.ts";
import v1SubgraphsRouter, {
	resetAnonDirectoryCache,
} from "../src/routes/v1-subgraphs.ts";

/**
 * OSS reads have no product keys, billing window, or Redis rate limit.
 */

const SKIP = !process.env.DATABASE_URL;

function buildApp(): Hono {
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/v1/subgraphs", v1SubgraphsRouter);
	return app;
}

describe.skipIf(SKIP)("local read path (oss)", () => {
	const prevMode = process.env.INSTANCE_MODE;

	afterAll(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	test("directory has no rate-limit headers and ignores product keys", async () => {
		process.env.INSTANCE_MODE = "oss";
		resetAnonDirectoryCache();
		const app = buildApp();
		const res = await app.request("/v1/subgraphs", {
			headers: { authorization: "Bearer sk-sl_not-a-real-key" },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("X-RateLimit-Limit")).toBeNull();
	});
});
