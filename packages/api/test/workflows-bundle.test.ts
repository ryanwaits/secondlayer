import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error.ts";
import workflowsRouter from "../src/routes/workflows.ts";

/**
 * Integration tests for POST /api/workflows/bundle — the server-side bundler
 * endpoint that powers the web chat authoring loop. The route itself is auth'd
 * via `requireAuth()` middleware mounted at the app level in `src/index.ts`;
 * here we mount the router with a tiny stand-in middleware that pre-populates
 * `c.set("apiKey", { id })` so `getApiKeyId(c)` succeeds without hitting the
 * real auth stack.
 */

function buildApp() {
	const app = new Hono();
	app.onError(errorHandler);
	app.use("/workflows/*", async (c, next) => {
		c.set("apiKey", { id: "test-key-workflows-bundle" });
		c.set("accountId", "test-account-workflows-bundle");
		await next();
	});
	app.route("/workflows", workflowsRouter);
	return app;
}

const validSource = `
import { defineWorkflow } from "@secondlayer/workflows";
export default defineWorkflow({
	name: "bundle-test",
	trigger: { type: "manual" },
	handler: async (ctx) => {
		await ctx.step.run("noop", async () => ({ ok: true }));
	},
});
`;

describe("POST /api/workflows/bundle", () => {
	test("happy path: valid source returns bundled handler + metadata", async () => {
		const app = buildApp();
		const res = await app.request("/workflows/bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: validSource }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			name: string;
			trigger: { type: string };
			handlerCode: string;
			sourceCode: string;
			bundleSize: number;
		};
		expect(body.ok).toBe(true);
		expect(body.name).toBe("bundle-test");
		expect(body.trigger.type).toBe("manual");
		expect(body.handlerCode.length).toBeGreaterThan(0);
		expect(body.sourceCode).toBe(validSource);
		expect(body.bundleSize).toBeGreaterThan(0);
	});

	test("missing body returns 400", async () => {
		const app = buildApp();
		const res = await app.request("/workflows/bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/code/);
	});

	test("invalid JSON body returns 400", async () => {
		const app = buildApp();
		const res = await app.request("/workflows/bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		expect(res.status).toBe(400);
	});

	test("oversized bundle returns 413 with actualBytes/maxBytes", async () => {
		const app = buildApp();
		const oversized = `
import { defineWorkflow } from "@secondlayer/workflows";
const BIG = ${JSON.stringify("x".repeat(1_200_000))};
export default defineWorkflow({
	name: "too-big",
	trigger: { type: "manual" },
	handler: async () => { return BIG.length; },
});
`;
		const res = await app.request("/workflows/bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: oversized }),
		});
		expect(res.status).toBe(413);
		const body = (await res.json()) as {
			ok: boolean;
			code: string;
			actualBytes: number;
			maxBytes: number;
		};
		expect(body.ok).toBe(false);
		expect(body.code).toBe("BUNDLE_TOO_LARGE");
		expect(body.actualBytes).toBeGreaterThan(body.maxBytes);
	});

	test("malformed TS returns 400 with BUNDLE_FAILED", async () => {
		const app = buildApp();
		const res = await app.request("/workflows/bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: "@@@ not valid typescript !!!" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { ok: boolean; code: string };
		expect(body.ok).toBe(false);
		expect(body.code).toBe("BUNDLE_FAILED");
	});
});
