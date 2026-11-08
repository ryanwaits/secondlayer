import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createApiApp } from "../create-app.ts";
import { errorHandler } from "./error.ts";
import { ACCOUNT_SCOPE_HEADER, testnetStackGuard } from "./testnet-stack.ts";

const prev = {
	flag: process.env.TESTNET_WEBHOOK_STACK,
	mode: process.env.INSTANCE_MODE,
	token: process.env.INSTANCE_TOKEN,
};

function restore(name: keyof typeof prev, key: string) {
	const value = prev[name];
	if (value === undefined) Reflect.deleteProperty(process.env, key);
	else process.env[key] = value;
}

afterEach(() => {
	restore("flag", "TESTNET_WEBHOOK_STACK");
	restore("mode", "INSTANCE_MODE");
	restore("token", "INSTANCE_TOKEN");
});

function guarded() {
	const app = new Hono();
	app.onError(errorHandler);
	app.use("*", testnetStackGuard());
	app.get("/health", (c) => c.json({ ok: true }));
	app.get("/api/webhooks", (c) => c.json({ ok: true }));
	app.get("/api/webhooks/abc/deliveries", (c) => c.json({ ok: true }));
	app.get("/api/subgraphs", (c) => c.json({ ok: true }));
	app.get("/v1/streams/events", (c) => c.json({ ok: true }));
	return app;
}

const scoped = {
	[ACCOUNT_SCOPE_HEADER]: "348a0000-0000-4000-8000-00000000000a",
};

describe("stack without the testnet flag", () => {
	test("refuses a request that carries the account scope header", async () => {
		Reflect.deleteProperty(process.env, "TESTNET_WEBHOOK_STACK");
		for (const path of ["/api/webhooks", "/api/subgraphs", "/health"]) {
			const res = await guarded().request(path, { headers: scoped });
			expect(res.status).toBe(403);
		}
	});

	test("refuses the header when the flag is set to anything but true", async () => {
		process.env.TESTNET_WEBHOOK_STACK = "";
		const res = await guarded().request("/api/webhooks", { headers: scoped });
		expect(res.status).toBe(403);
	});

	test("serves a plain tenant request, which never carries the header", async () => {
		Reflect.deleteProperty(process.env, "TESTNET_WEBHOOK_STACK");
		for (const path of [
			"/api/webhooks",
			"/api/webhooks/abc/deliveries",
			"/api/subgraphs",
			"/v1/streams/events",
			"/health",
		]) {
			const res = await guarded().request(path);
			expect(res.status).toBe(200);
		}
	});
});

describe("testnet stack", () => {
	test("serves webhook routes and the health probe", async () => {
		process.env.TESTNET_WEBHOOK_STACK = "true";
		for (const path of [
			"/api/webhooks",
			"/api/webhooks/abc/deliveries",
			"/health",
		]) {
			const res = await guarded().request(path, { headers: scoped });
			expect(res.status).toBe(200);
		}
	});

	test("refuses every non-webhook route", async () => {
		process.env.TESTNET_WEBHOOK_STACK = "true";
		for (const path of [
			"/api/subgraphs",
			"/v1/streams/events",
			"/api/webhooks-evil",
			"/status",
		]) {
			const res = await guarded().request(path, { headers: scoped });
			expect(res.status).toBe(403);
		}
	});
});

describe("assembled API app", () => {
	test("a tenant stack refuses the scope header before auth runs", async () => {
		process.env.INSTANCE_MODE = "oss";
		process.env.INSTANCE_TOKEN = "t".repeat(32);
		Reflect.deleteProperty(process.env, "TESTNET_WEBHOOK_STACK");
		const res = await createApiApp("oss").request("/api/webhooks", {
			headers: { ...scoped, authorization: `Bearer ${"t".repeat(32)}` },
		});
		expect(res.status).toBe(403);
	});

	test("the testnet stack refuses non-webhook routes even with the instance token", async () => {
		process.env.INSTANCE_MODE = "oss";
		process.env.INSTANCE_TOKEN = "t".repeat(32);
		process.env.TESTNET_WEBHOOK_STACK = "true";
		const res = await createApiApp("oss").request("/api/subgraphs", {
			headers: { ...scoped, authorization: `Bearer ${"t".repeat(32)}` },
		});
		expect(res.status).toBe(403);
	});

	test("a plain tenant stack still answers /health", async () => {
		process.env.INSTANCE_MODE = "oss";
		Reflect.deleteProperty(process.env, "TESTNET_WEBHOOK_STACK");
		const res = await createApiApp("oss").request("/health");
		expect(res.status).toBe(200);
	});
});
