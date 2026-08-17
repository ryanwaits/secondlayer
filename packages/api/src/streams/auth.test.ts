import { afterEach, describe, expect, test } from "bun:test";
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
			? { tenant_id: "t1", tier: "free", scopes: ["streams:read"] }
			: undefined,
};

function app(allowAnon?: boolean) {
	const a = new Hono<StreamsEnv>();
	a.onError(errorHandler);
	a.use("*", streamsBearerAuth({ tokens, allowAnon }));
	a.get("/x", (c) =>
		c.json({ ok: true, tenant: c.get("streamsTenant") ?? null }),
	);
	return a;
}

describe("streamsBearerAuth", () => {
	const prevHost = process.env.LISTEN_HOST;

	afterEach(() => {
		if (prevHost === undefined)
			Reflect.deleteProperty(process.env, "LISTEN_HOST");
		else process.env.LISTEN_HOST = prevHost;
	});

	test("a keyless read is served when anonymous access is allowed", async () => {
		const res = await app(true).request("/x");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, tenant: null });
	});

	test("a keyless read is rejected when anonymous access is not allowed", async () => {
		expect((await app(false).request("/x")).status).toBe(401);
	});

	test("an unrecognized key is ignored, not fatal, where anon reads work", async () => {
		const res = await app(true).request("/x", {
			headers: { authorization: "Bearer nope" },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, tenant: null });
	});

	test("an unrecognized key is rejected where a credential is mandatory", async () => {
		const res = await app(false).request("/x", {
			headers: { authorization: "Bearer nope" },
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as {
			details?: { env_var?: string; hint?: string };
		};
		expect(body.details?.env_var).toBe("INSTANCE_TOKEN");
		expect(body.details?.hint).toContain("secondlayer init");
	});

	test("a valid key resolves the tenant", async () => {
		const res = await app(true).request("/x", {
			headers: { authorization: "Bearer good-key" },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { tenant: { tenant_id: string } };
		expect(body.tenant).toMatchObject({ tenant_id: "t1" });
	});

	test("with no override, a loopback bind serves keyless reads", async () => {
		process.env.LISTEN_HOST = "127.0.0.1";
		expect((await app().request("/x")).status).toBe(200);
	});

	test("with no override, a bind past loopback demands a credential", async () => {
		process.env.LISTEN_HOST = "0.0.0.0";
		expect((await app().request("/x")).status).toBe(401);
	});
});
