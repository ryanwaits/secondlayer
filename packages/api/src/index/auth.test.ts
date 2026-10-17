import { describe, expect, test } from "bun:test";
import {
	INDEX_INTERNAL_TENANT_ID,
	defaultInternalIndexApiKey,
} from "@secondlayer/shared/index-internal-auth";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import {
	DEFAULT_INDEX_TOKENS,
	INDEX_READ_SCOPE,
	type IndexEnv,
	type IndexTokenStore,
	indexBearerAuth,
} from "./auth.ts";

describe("index internal token", () => {
	test("internal key resolves to an unmetered internal tenant when env is set", async () => {
		const seeded = process.env.INDEX_INTERNAL_API_KEY?.trim();
		if (seeded) {
			const tenant = await DEFAULT_INDEX_TOKENS.get(seeded);
			expect(tenant).toBeDefined();
			expect(tenant?.tenant_id).toBe(INDEX_INTERNAL_TENANT_ID);
			expect(tenant?.tier).toBe("internal");
			// No account_id → Index metering (`accountId && …`) never fires for the
			// internal consumer, so PublicApiBlockSource reads are unmetered.
			expect(tenant?.account_id).toBeUndefined();
			expect(tenant?.scopes).toContain(INDEX_READ_SCOPE);
			return;
		}
		// Module loaded without INDEX_INTERNAL_API_KEY: helper may return
		// INSTANCE_TOKEN, which is not in this static map (instanceTokenMatches
		// handles that path). Guard Map.get so we never pass undefined.
		const fallback = defaultInternalIndexApiKey();
		if (fallback) {
			expect(await DEFAULT_INDEX_TOKENS.get(fallback)).toBeUndefined();
		} else {
			expect(fallback).toBeUndefined();
		}
	});
});

describe("indexBearerAuth revoked keys", () => {
	const tokens: IndexTokenStore = { get: async () => undefined };
	function app(
		findRevoked: (
			raw: string,
		) => Promise<{ id: string; account_id: string } | null>,
	) {
		const a = new Hono<IndexEnv>();
		a.onError(errorHandler);
		a.use("*", indexBearerAuth({ tokens, allowAnon: false, findRevoked }));
		a.get("/x", (c) => c.json({ ok: true }));
		return a;
	}
	const headers = { authorization: "Bearer some-key" };

	test("a revoked account key is refused as KEY_REVOKED", async () => {
		const res = await app(async () => ({ id: "k1", account_id: "a1" })).request(
			"/x",
			{ headers },
		);
		expect(res.status).toBe(401);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("KEY_REVOKED");
	});

	test("an unknown key still reads as unrecognized", async () => {
		const res = await app(async () => null).request("/x", { headers });
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Unrecognized API key");
	});
});
