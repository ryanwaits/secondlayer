import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import {
	type StreamsEnv,
	type StreamsTokenStore,
	streamsBearerAuth,
} from "./auth.ts";

// Token store that knows exactly one valid key (no DB).
const tokens: StreamsTokenStore = {
	get: async (raw) =>
		raw === "good-key"
			? { tenant_id: "t1", tier: "build", scopes: ["streams:read"] }
			: undefined,
};

function app(allowAnon: boolean) {
	const a = new Hono<StreamsEnv>();
	a.onError(errorHandler);
	a.use("*", streamsBearerAuth({ tokens, allowAnon }));
	a.get("/x", (c) =>
		c.json({ ok: true, tenant: c.get("streamsTenant") ?? null }),
	);
	return a;
}

describe("streamsBearerAuth allowAnon", () => {
	test("allowAnon=false: no key → 401 (key-mandatory, unchanged)", async () => {
		expect((await app(false).request("/x")).status).toBe(401);
	});

	test("allowAnon=true: no key → falls through (no tenant) for x402 to gate", async () => {
		const res = await app(true).request("/x");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, tenant: null });
	});

	test("an invalid key is rejected regardless of allowAnon", async () => {
		const res = await app(true).request("/x", {
			headers: { authorization: "Bearer nope" },
		});
		expect(res.status).toBe(401);
	});

	test("a valid key resolves the tenant", async () => {
		const res = await app(true).request("/x", {
			headers: { authorization: "Bearer good-key" },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { tenant: { tenant_id: string } };
		expect(body.tenant).toMatchObject({ tenant_id: "t1" });
	});
});
