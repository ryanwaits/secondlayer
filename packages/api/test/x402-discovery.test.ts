import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import openapiRouter from "../src/routes/openapi.ts";
import x402Router from "../src/routes/x402.ts";

/** Discovery surfaces for the pay-per-call rail — public, no auth, work with
 *  the rail off (enabled:false) so agents can always probe capabilities.
 *  src/index.ts boots Bun.serve, so we mirror its mounts on a mini app. */
function buildApp() {
	const app = new Hono();
	app.route("/x402", x402Router);
	app.route("/v1/x402", x402Router);
	app.get("/.well-known/x402", (c) =>
		c.json({
			x402Version: 2,
			supported: "/v1/x402/supported",
			docs: "https://secondlayer.tools/pricing#pay-per-call",
		}),
	);
	app.route("/v1/openapi.json", openapiRouter);
	return app;
}

describe("x402 discovery", () => {
	const app = buildApp();

	test("GET /v1/x402/supported advertises the rail", async () => {
		const res = await app.request("/v1/x402/supported");
		expect(res.status).toBe(200);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const body = (await res.json()) as any;
		expect(body.x402Version).toBe(2);
		expect(typeof body.enabled).toBe("boolean");
		expect(body.kinds[0].network).toBe("stacks:1");
		expect(body.catalog.index.priceUsd).toBeGreaterThan(0);
		expect(body.floorUsd).toBeGreaterThan(0);
		expect(body.paymentHeader).toBe("PAYMENT-SIGNATURE");
	});

	test("legacy /x402/supported alias still serves", async () => {
		const res = await app.request("/x402/supported");
		expect(res.status).toBe(200);
	});

	test("GET /.well-known/x402 points at the supported endpoint", async () => {
		const res = await app.request("/.well-known/x402");
		expect(res.status).toBe(200);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const body = (await res.json()) as any;
		expect(body.supported).toBe("/v1/x402/supported");
	});

	test("OpenAPI spec carries the x-x402 block", async () => {
		const res = await app.request("/v1/openapi.json");
		expect(res.status).toBe(200);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const body = (await res.json()) as any;
		expect(body["x-x402"].supported).toBe("/v1/x402/supported");
		expect(body.paths["/v1/x402/supported"]).toBeDefined();
	});
});
