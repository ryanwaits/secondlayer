import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	approveOauthRequest,
	createOauthRequest,
	exchangeOauthCode,
	registerOauthClient,
} from "@secondlayer/platform/db/queries/oauth";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { createApiKeyTokenStore } from "../api-key-store.ts";
import { requireAuth } from "../middleware.ts";
import { isMcpRequest, markMcpRequest } from "./audience.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const saved: Record<string, string | undefined> = {};
const accountIds: string[] = [];
const clientIds: string[] = [];

beforeAll(() => {
	for (const k of ["INSTANCE_MODE", "DEV_MODE"]) saved[k] = process.env[k];
	process.env.INSTANCE_MODE = "platform";
	process.env.DEV_MODE = "false";
});

afterAll(async () => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	}
	if (HAS_DB && clientIds.length)
		await db.deleteFrom("oauth_clients").where("id", "in", clientIds).execute();
	if (HAS_DB && accountIds.length)
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

test("only a marked request is the MCP's", () => {
	const a = new Request("http://x/v1");
	const b = new Request("http://x/v1");
	markMcpRequest(a);
	expect(isMcpRequest(a)).toBe(true);
	expect(isMcpRequest(b)).toBe(false);
	expect(isMcpRequest(undefined)).toBe(false);
	// A copy of a marked request is a new request: not marked.
	expect(isMcpRequest(new Request(a))).toBe(false);
});

async function accessToken(): Promise<{ token: string; accountId: string }> {
	const acct = await db
		.insertInto("accounts")
		.values({ email: `aud-${crypto.randomUUID()}@example.com` })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(acct.id);
	const verifier = `v${"y".repeat(50)}`;
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	const client = await registerOauthClient(db, {
		name: "t",
		redirectUris: ["http://127.0.0.1:1/cb"],
		ip: null,
	});
	clientIds.push(client.id);
	const reqId = await createOauthRequest(db, {
		clientId: client.id,
		redirectUri: "http://127.0.0.1:1/cb",
		state: null,
		codeChallenge: challenge,
		resource: "https://api.test/mcp",
	});
	const ok = await approveOauthRequest(db, reqId, acct.id);
	const r = await exchangeOauthCode(db, {
		code: ok?.code ?? "",
		clientId: client.id,
		redirectUri: "http://127.0.0.1:1/cb",
		codeVerifier: verifier,
		resource: null,
	});
	if (!r.ok) throw new Error(r.error.error_description);
	return { token: r.tokens.access_token, accountId: acct.id };
}

describe.skipIf(!HAS_DB)("an OAuth access token's audience", () => {
	test("the token store resolves it only on a marked request, and only for Index and Streams", async () => {
		const { token, accountId } = await accessToken();
		const store = (product: "index" | "streams" | "chain-read" | "sentinel") =>
			createApiKeyTokenStore({
				staticTokens: new Map(),
				requiredScope: `${product}:read`,
				product,
			});
		const marked = new Request("http://x/v1/index/blocks");
		markMcpRequest(marked);
		expect(await store("index").get(token)).toBeUndefined();
		expect(
			await store("index").get(token, new Request("http://x/v1")),
		).toBeUndefined();
		const tenant = await store("index").get(token, marked);
		expect(tenant).toMatchObject({
			account_id: accountId,
			tier: "free",
			scopes: ["index:read"],
		});
		expect(tenant?.api_key_id).toBeUndefined();
		expect((await store("streams").get(token, marked))?.account_id).toBe(
			accountId,
		);
		expect(await store("chain-read").get(token, marked)).toBeUndefined();
		expect(await store("sentinel").get(token, marked)).toBeUndefined();
	});

	test("requireAuth takes it only where a route opts in, and only on a marked request", async () => {
		const { token, accountId } = await accessToken();
		const app = new Hono<{ Variables: { accountId: string } }>();
		app.get("/plain", requireAuth(), (c) => c.json({ a: c.get("accountId") }));
		app.get("/opted", requireAuth({ oauth: () => true }), (c) =>
			c.json({ a: c.get("accountId") }),
		);
		const call = (path: string, mark: boolean) => {
			const req = new Request(`http://x${path}`, {
				headers: { authorization: `Bearer ${token}` },
			});
			if (mark) markMcpRequest(req);
			return app.fetch(req);
		};
		expect((await call("/plain", true)).status).not.toBe(200);
		expect((await call("/opted", false)).status).not.toBe(200);
		const ok = await call("/opted", true);
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ a: accountId });
	});
});
