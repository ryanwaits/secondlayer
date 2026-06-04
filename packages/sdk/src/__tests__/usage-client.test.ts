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

describe("usage clients", () => {
	test("streams.usage() GETs /v1/streams/usage", async () => {
		const paths: string[] = [];
		globalThis.fetch = (async (input, init) => {
			const req =
				input instanceof Request ? input : new Request(input.toString(), init);
			paths.push(new URL(req.url).pathname);
			return json({
				product: "streams",
				tier: "build",
				limits: { rate_limit_per_second: 50, retention_days: 30 },
				usage: { events_today: 10, events_this_month: 100 },
			});
		}) as typeof fetch;

		const res = await new SecondLayer({ apiKey: "sk-test" }).streams.usage();
		expect(res.tier).toBe("build");
		expect(res.usage.events_today).toBe(10);
		expect(paths[0]).toBe("/v1/streams/usage");
	});

	test("index.usage() GETs /v1/index/usage", async () => {
		const paths: string[] = [];
		globalThis.fetch = (async (input, init) => {
			const req =
				input instanceof Request ? input : new Request(input.toString(), init);
			paths.push(new URL(req.url).pathname);
			return json({
				product: "index",
				tier: "scale",
				limits: { rate_limit_per_second: 250 },
				usage: { decoded_events_today: 5, decoded_events_this_month: 50 },
			});
		}) as typeof fetch;

		const res = await new SecondLayer({ apiKey: "sk-test" }).index.usage();
		expect(res.tier).toBe("scale");
		expect(res.usage.decoded_events_this_month).toBe(50);
		expect(paths[0]).toBe("/v1/index/usage");
	});
});
