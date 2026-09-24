import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error.ts";
import v1SubgraphsRouter, {
	resetAnonDirectoryCache,
} from "../src/routes/v1-subgraphs.ts";

/** Anon `/v1/subgraphs` directory memoization on an OSS loopback bind. */

const SKIP = !process.env.DATABASE_URL;

const ENV_KEYS = ["INSTANCE_MODE", "LISTEN_HOST", "API_PUBLISH_ADDR"] as const;

function buildApp(): Hono {
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/", v1SubgraphsRouter);
	return app;
}

describe.skipIf(SKIP)("anon /v1/subgraphs directory cache", () => {
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const k of ENV_KEYS) saved[k] = process.env[k];
		process.env.INSTANCE_MODE = "oss";
		process.env.LISTEN_HOST = "127.0.0.1";
		delete process.env.API_PUBLISH_ADDR;
		resetAnonDirectoryCache();
	});

	afterEach(() => {
		for (const k of ENV_KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	test("two anon requests within the TTL return byte-identical bodies and the same ETag", async () => {
		const app = buildApp();
		const first = await app.request("/");
		const firstBody = await first.text();
		const firstEtag = first.headers.get("etag");
		expect(first.status).toBe(200);
		expect(firstEtag).toBeTruthy();

		const second = await app.request("/");
		const secondBody = await second.text();
		const secondEtag = second.headers.get("etag");

		expect(secondBody).toBe(firstBody);
		expect(secondEtag).toBe(firstEtag);
	});

	test("If-None-Match with the cached ETag returns 304", async () => {
		const app = buildApp();
		const first = await app.request("/");
		const etag = first.headers.get("etag");
		expect(etag).toBeTruthy();

		const revalidated = await app.request("/", {
			headers: { "if-none-match": String(etag) },
		});
		expect(revalidated.status).toBe(304);
	});
});
