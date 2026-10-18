import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createHash } from "node:crypto";
import { resolveOauthAccessToken } from "@secondlayer/platform/db/queries/oauth";
import { getDb } from "@secondlayer/shared/db";
import { generateSessionToken, hashToken } from "../auth/keys.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import { createApiApp } from "../create-app.ts";

const ORIGIN = "https://api.consent.test";
const REDIRECT = "http://127.0.0.1:53682/callback";
const VERIFIER = `v${"x".repeat(42)}${crypto.randomUUID().replace(/-/g, "")}`;
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const saved: Record<string, string | undefined> = {};
const accountIds: string[] = [];

beforeAll(() => {
	for (const k of ["INSTANCE_MODE", "DEV_MODE", "API_PUBLIC_URL"])
		saved[k] = process.env[k];
	process.env.INSTANCE_MODE = "platform";
	process.env.DEV_MODE = "false";
	process.env.API_PUBLIC_URL = ORIGIN;
});

afterAll(async () => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	}
	if (!HAS_DB || accountIds.length === 0) return;
	await db
		.deleteFrom("sessions")
		.where("account_id", "in", accountIds)
		.execute();
	await db
		.deleteFrom("api_keys")
		.where("account_id", "in", accountIds)
		.execute();
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

beforeEach(async () => {
	await getRateLimitStore().clear();
});

const app = createApiApp("platform");

async function account() {
	const row = await db
		.insertInto("accounts")
		.values({ email: `consent-${crypto.randomUUID()}@example.com` })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	const s = generateSessionToken();
	await db
		.insertInto("sessions")
		.values({
			token_hash: s.hash,
			token_prefix: s.prefix,
			account_id: row.id,
			ip_address: "test",
		})
		.execute();
	const key = `sk-sl_consent_${crypto.randomUUID()}`;
	await db
		.insertInto("api_keys")
		.values({
			key_hash: hashToken(key),
			key_prefix: key.slice(0, 14),
			account_id: row.id,
			ip_address: "test",
			product: "account",
			tier: "free",
			status: "active",
		})
		.execute();
	return { id: row.id, session: s.raw, key };
}

const call = (method: string, path: string, bearer?: string, body?: unknown) =>
	app.request(path, {
		method,
		headers: {
			...(body !== undefined ? { "content-type": "application/json" } : {}),
			...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});

/** Register and authorize: a pending request id and its client. */
async function pending(name = "Claude Code") {
	const reg = await app.request("/oauth/register", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: name }),
	});
	const { client_id } = (await reg.json()) as { client_id: string };
	const u = new URLSearchParams({
		response_type: "code",
		client_id,
		redirect_uri: REDIRECT,
		code_challenge: CHALLENGE,
		code_challenge_method: "S256",
		resource: `${ORIGIN}/mcp`,
		state: "st-9",
	});
	const r = await app.request(`/oauth/authorize?${u}`);
	const req = new URL(r.headers.get("location") ?? "").searchParams.get("req");
	return { clientId: client_id, requestId: req ?? "" };
}

async function tokensFor(session: string) {
	const { clientId, requestId } = await pending();
	const ok = await call(
		"POST",
		`/api/oauth/requests/${requestId}/approve`,
		session,
		{},
	);
	const back = new URL(((await ok.json()) as { redirect: string }).redirect);
	const res = await app.request("/oauth/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: clientId,
			code: back.searchParams.get("code") ?? "",
			redirect_uri: REDIRECT,
			code_verifier: VERIFIER,
		}).toString(),
	});
	return (await res.json()) as { access_token: string; refresh_token: string };
}

describe.skipIf(!HAS_DB)("consent routes (sessions only)", () => {
	test("read shows the client's name and the redirect host", async () => {
		const me = await account();
		const { requestId } = await pending('My "agent" <b>');
		const r = await call("GET", `/api/oauth/requests/${requestId}`, me.session);
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({
			id: requestId,
			clientName: 'My "agent" <b>',
			redirectHost: "127.0.0.1:53682",
		});
	});

	test("approve returns the registered redirect with a code, the state and iss", async () => {
		const me = await account();
		const { requestId } = await pending();
		const r = await call(
			"POST",
			`/api/oauth/requests/${requestId}/approve`,
			me.session,
			{},
		);
		expect(r.status).toBe(200);
		const back = new URL(((await r.json()) as { redirect: string }).redirect);
		expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
		expect(back.searchParams.get("code")?.length).toBeGreaterThan(20);
		expect(back.searchParams.get("state")).toBe("st-9");
		expect(back.searchParams.get("iss")).toBe(ORIGIN);
		// Answered once: a second approve or a read finds nothing.
		expect(
			(
				await call(
					"POST",
					`/api/oauth/requests/${requestId}/approve`,
					me.session,
					{},
				)
			).status,
		).toBe(404);
		expect(
			(await call("GET", `/api/oauth/requests/${requestId}`, me.session))
				.status,
		).toBe(404);
	});

	test("deny returns access_denied and no code", async () => {
		const me = await account();
		const { requestId } = await pending();
		const r = await call(
			"POST",
			`/api/oauth/requests/${requestId}/deny`,
			me.session,
			{},
		);
		const back = new URL(((await r.json()) as { redirect: string }).redirect);
		expect(back.searchParams.get("error")).toBe("access_denied");
		expect(back.searchParams.get("state")).toBe("st-9");
		expect(back.searchParams.get("code")).toBeNull();
	});

	test("an API key or an app's token gets 403 on every consent and grant route", async () => {
		const me = await account();
		const { access_token } = await tokensFor(me.session);
		const { requestId } = await pending();
		const grants = (await (
			await call("GET", "/api/oauth/grants", me.session)
		).json()) as { grants: { id: string }[] };
		const grantId = grants.grants[0].id;
		for (const bearer of [me.key, access_token, "oat-sl_unknown"]) {
			for (const [method, path, body] of [
				["GET", `/api/oauth/requests/${requestId}`, undefined],
				["POST", `/api/oauth/requests/${requestId}/approve`, {}],
				["POST", `/api/oauth/requests/${requestId}/deny`, {}],
				["GET", "/api/oauth/grants", undefined],
				["DELETE", `/api/oauth/grants/${grantId}`, undefined],
			] as const) {
				const r = await call(method, path, bearer, body);
				expect(r.status, `${bearer.slice(0, 7)} ${method} ${path}`).toBe(403);
			}
		}
		// Still pending and still live: nothing above did anything.
		expect(
			(await call("GET", `/api/oauth/requests/${requestId}`, me.session))
				.status,
		).toBe(200);
		expect(await resolveOauthAccessToken(db, access_token)).not.toBeNull();
		// No credential at all is 401.
		expect((await call("GET", "/api/oauth/grants")).status).toBe(401);
	});

	test("an app's token can't manage keys either", async () => {
		const me = await account();
		const { access_token } = await tokensFor(me.session);
		expect((await call("GET", "/api/keys", access_token)).status).toBe(401);
		expect(
			(await call("POST", "/api/keys", access_token, { name: "x" })).status,
		).toBe(401);
	});

	test("grants list the app; revoking one makes its next token use fail", async () => {
		const me = await account();
		const other = await account();
		const { access_token, refresh_token } = await tokensFor(me.session);
		const list = (await (
			await call("GET", "/api/oauth/grants", me.session)
		).json()) as { grants: { id: string; clientName: string }[] };
		expect(list.grants).toHaveLength(1);
		expect(list.grants[0].clientName).toBe("Claude Code");
		const id = list.grants[0].id;
		// Someone else's session can't see or revoke it.
		expect(
			(
				(await (
					await call("GET", "/api/oauth/grants", other.session)
				).json()) as { grants: unknown[] }
			).grants,
		).toEqual([]);
		expect(
			(await call("DELETE", `/api/oauth/grants/${id}`, other.session)).status,
		).toBe(404);
		expect(await resolveOauthAccessToken(db, access_token)).not.toBeNull();

		const r = await call("DELETE", `/api/oauth/grants/${id}`, me.session);
		expect(r.status).toBe(200);
		expect(await resolveOauthAccessToken(db, access_token)).toBeNull();
		const refreshed = await app.request("/oauth/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				client_id: (
					await db
						.selectFrom("oauth_grants")
						.select("client_id")
						.where("id", "=", id)
						.executeTakeFirstOrThrow()
				).client_id,
				refresh_token,
			}).toString(),
		});
		expect(refreshed.status).toBe(400);
		expect(
			(
				(await (await call("GET", "/api/oauth/grants", me.session)).json()) as {
					grants: unknown[];
				}
			).grants,
		).toEqual([]);
	});

	test("a malformed request or grant id is 404", async () => {
		const me = await account();
		expect(
			(await call("GET", "/api/oauth/requests/not-a-request", me.session))
				.status,
		).toBe(404);
		expect(
			(await call("DELETE", "/api/oauth/grants/not-a-uuid", me.session)).status,
		).toBe(404);
	});
});
