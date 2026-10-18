import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createHash } from "node:crypto";
import {
	approveOauthRequest,
	resolveOauthAccessToken,
} from "@secondlayer/platform/db/queries/oauth";
import { getDb } from "@secondlayer/shared/db";
import { createApiApp } from "../../create-app.ts";
import { getRateLimitStore } from "../rate-limit-store.ts";
import { mcpChallenge } from "./config.ts";
import {
	allowedRedirect,
	clientNameProblem,
	hasInvisible,
	rateKeyOf,
} from "./validate.ts";

const ORIGIN = "https://api.oauth.test";
const WEB = "https://web.oauth.test";
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = "http://127.0.0.1:53682/callback";
const VERIFIER = `v${"x".repeat(42)}${crypto.randomUUID().replace(/-/g, "")}`;
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

describe("redirect URIs a public client may register", () => {
	test("https anywhere, http only on loopback", () => {
		expect(allowedRedirect("https://app.example/cb")).toBe(true);
		expect(allowedRedirect("http://127.0.0.1:5000/cb")).toBe(true);
		expect(allowedRedirect("http://localhost/cb")).toBe(true);
		expect(allowedRedirect("http://[::1]:8080/cb")).toBe(true);
		expect(allowedRedirect("http://example.com/cb")).toBe(false);
		expect(allowedRedirect("http://127.0.0.1.evil.com/cb")).toBe(false);
		expect(allowedRedirect("javascript:alert(1)")).toBe(false);
		expect(allowedRedirect("myapp://cb")).toBe(false);
	});

	test("no fragment, no userinfo, at most 512 characters", () => {
		expect(allowedRedirect("https://app.example/cb#x")).toBe(false);
		expect(allowedRedirect("https://app.example/cb#")).toBe(false);
		expect(allowedRedirect("https://user@app.example/cb")).toBe(false);
		expect(allowedRedirect("https://u:p@app.example/cb")).toBe(false);
		expect(allowedRedirect(`https://app.example/${"a".repeat(500)}`)).toBe(
			false,
		);
	});
});

describe("client names", () => {
	test("control, zero-width, bidi and tag characters are refused", () => {
		for (const cp of [
			0x0a, 0x00, 0x7f, 0x85, 0x200b, 0x200d, 0x200e, 0x202e, 0x2066, 0x2028,
			0xfeff, 0xe0041,
		]) {
			const name = `Claude${String.fromCodePoint(cp)}Code`;
			expect(hasInvisible(name), cp.toString(16)).toBe(true);
			expect(clientNameProblem(name)).not.toBeNull();
		}
	});

	test("a plain name passes; empty, blank and long ones do not", () => {
		expect(clientNameProblem("Claude Code")).toBeNull();
		expect(clientNameProblem("Café · 日本語")).toBeNull();
		expect(clientNameProblem("")).not.toBeNull();
		expect(clientNameProblem("   ")).not.toBeNull();
		expect(clientNameProblem("a".repeat(65))).not.toBeNull();
		expect(clientNameProblem(42)).not.toBeNull();
	});
});

describe("rate keys", () => {
	test("IPv6 counts by its /64; IPv4-mapped as the IPv4 address", () => {
		expect(rateKeyOf("203.0.113.9")).toBe("203.0.113.9");
		expect(rateKeyOf("2001:db8:1:2:aaaa::1")).toBe("2001:0db8:0001:0002::/64");
		expect(rateKeyOf("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(
			"2001:0db8:0001:0002::/64",
		);
		expect(rateKeyOf("[2001:DB8:1:2::7]")).toBe("2001:0db8:0001:0002::/64");
		expect(rateKeyOf("2001:db8:1:3::1")).toBe("2001:0db8:0001:0003::/64");
		expect(rateKeyOf("::ffff:198.51.100.4")).toBe("198.51.100.4");
		expect(rateKeyOf("fe80::1%eth0")).toBe("fe80:0000:0000:0000::/64");
		expect(rateKeyOf("unknown")).toBe("unknown");
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const saved: Record<string, string | undefined> = {};
const accountIds: string[] = [];

beforeAll(() => {
	for (const k of ["INSTANCE_MODE", "DEV_MODE", "API_PUBLIC_URL", "WEB_URL"])
		saved[k] = process.env[k];
	process.env.INSTANCE_MODE = "platform";
	process.env.DEV_MODE = "false";
	process.env.API_PUBLIC_URL = `${ORIGIN}/`;
	process.env.WEB_URL = WEB;
});

afterAll(async () => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	}
	if (HAS_DB && accountIds.length)
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

beforeEach(async () => {
	await getRateLimitStore().clear();
});

const app = createApiApp("platform");

const ip = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

const register = (body: unknown, from = ip()) =>
	app.request("/oauth/register", {
		method: "POST",
		headers: { "content-type": "application/json", "x-forwarded-for": from },
		body: JSON.stringify(body),
	});

async function registered(
	redirect = REDIRECT,
	name = "Claude Code",
): Promise<string> {
	const r = await register({ redirect_uris: [redirect], client_name: name });
	expect(r.status).toBe(201);
	return ((await r.json()) as { client_id: string }).client_id;
}

function authorizeUrl(clientId: string, over: Record<string, string | null>) {
	const q: Record<string, string | null> = {
		response_type: "code",
		client_id: clientId,
		redirect_uri: REDIRECT,
		code_challenge: CHALLENGE,
		code_challenge_method: "S256",
		resource: RESOURCE,
		state: "st-1",
		scope: "mcp",
		...over,
	};
	const u = new URL("/oauth/authorize", ORIGIN);
	for (const [k, v] of Object.entries(q))
		if (v !== null) u.searchParams.set(k, v);
	return `${u.pathname}${u.search}`;
}

const authorize = (
	clientId: string,
	over: Record<string, string | null> = {},
) =>
	app.request(authorizeUrl(clientId, over), {
		headers: { "x-forwarded-for": ip() },
	});

const tokenRequest = (fields: Record<string, string>) =>
	app.request("/oauth/token", {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			"x-forwarded-for": ip(),
		},
		body: new URLSearchParams(fields).toString(),
	});

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: `oauth-routes-${crypto.randomUUID()}@example.com` })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

/** Register, authorize, approve (as the consent page would). */
async function approved() {
	const clientId = await registered();
	const r = await authorize(clientId);
	expect(r.status).toBe(302);
	const location = new URL(r.headers.get("location") ?? "");
	const requestId = location.searchParams.get("req") ?? "";
	const ok = await approveOauthRequest(db, requestId, await makeAccount());
	if (!ok) throw new Error("not approved");
	return { clientId, code: ok.code };
}

const exchange = (
	clientId: string,
	code: string,
	over: Record<string, string> = {},
) =>
	tokenRequest({
		grant_type: "authorization_code",
		client_id: clientId,
		code,
		redirect_uri: REDIRECT,
		code_verifier: VERIFIER,
		resource: RESOURCE,
		...over,
	});

type Tokens = { access_token: string; refresh_token: string };

describe("metadata", () => {
	test("issuer and resource come from API_PUBLIC_URL, even with a spoofed Host", async () => {
		const as = await app.request("/.well-known/oauth-authorization-server", {
			headers: { host: "evil.example", "x-forwarded-host": "evil.example" },
		});
		expect(as.status).toBe(200);
		const meta = (await as.json()) as Record<string, unknown>;
		expect(meta.issuer).toBe(ORIGIN);
		expect(meta.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
		expect(meta.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
		expect(meta.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
		expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
		expect(meta.token_endpoint_auth_methods_supported).toEqual(["none"]);
		expect(meta.authorization_response_iss_parameter_supported).toBe(true);

		const pr = await app.request("/.well-known/oauth-protected-resource/mcp", {
			headers: { host: "evil.example" },
		});
		const prm = (await pr.json()) as Record<string, unknown>;
		expect(prm.resource).toBe(RESOURCE);
		expect(prm.authorization_servers).toEqual([ORIGIN]);
		const root = (await (
			await app.request("/.well-known/oauth-protected-resource")
		).json()) as Record<string, unknown>;
		expect(root.resource).toBe(ORIGIN);
	});

	test("the /mcp challenge names the resource metadata", () => {
		expect(mcpChallenge(ORIGIN)).toBe(
			`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
		);
		expect(mcpChallenge(ORIGIN, true)).toContain('error="invalid_token"');
	});

	test("CORS: any origin, no credentials, preflight 204", async () => {
		const pre = await app.request("/oauth/token", {
			method: "OPTIONS",
			headers: {
				origin: "https://some.app",
				"access-control-request-method": "POST",
				"access-control-request-headers": "content-type",
			},
		});
		expect(pre.status).toBe(204);
		expect(pre.headers.get("access-control-allow-origin")).toBe("*");
		expect(pre.headers.get("access-control-allow-credentials")).toBeNull();
		expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
		const get = await app.request("/.well-known/oauth-authorization-server", {
			headers: { origin: "https://some.app" },
		});
		expect(get.headers.get("access-control-allow-origin")).toBe("*");
		expect(get.headers.get("access-control-allow-credentials")).toBeNull();
	});

	test("a wrong method is 405", async () => {
		expect((await app.request("/oauth/token")).status).toBe(405);
		expect(
			(
				await app.request("/.well-known/oauth-authorization-server", {
					method: "POST",
				})
			).status,
		).toBe(405);
	});
});

describe.skipIf(!HAS_DB)("registration (DCR)", () => {
	test("a public client with a loopback redirect registers", async () => {
		const r = await register({
			redirect_uris: [REDIRECT],
			client_name: "Claude Code",
		});
		expect(r.status).toBe(201);
		expect(r.headers.get("cache-control")).toBe("no-store");
		const body = (await r.json()) as Record<string, unknown>;
		expect(body.client_id).toMatch(/^ocl_/);
		expect(body.token_endpoint_auth_method).toBe("none");
		expect(body.client_secret).toBeUndefined();
	});

	test("refuses bad redirects, confidential clients, other grants and bad names", async () => {
		for (const body of [
			{ redirect_uris: [] },
			{ redirect_uris: ["http://example.com/cb"] },
			{ redirect_uris: ["https://app.example/cb#frag"] },
			{ redirect_uris: ["https://user@app.example/cb"] },
			{ redirect_uris: Array(11).fill("https://app.example/cb") },
			{
				redirect_uris: [REDIRECT],
				token_endpoint_auth_method: "client_secret_basic",
			},
			{ redirect_uris: [REDIRECT], grant_types: ["client_credentials"] },
			{ redirect_uris: [REDIRECT], response_types: ["token"] },
			{ redirect_uris: [REDIRECT], client_name: "x".repeat(65) },
			{ redirect_uris: [REDIRECT], client_name: "Claude‮edoC" },
			{ redirect_uris: [REDIRECT], client_name: "Claude\nCode" },
			{ redirect_uris: [REDIRECT], client_name: "Claude​Code" },
		]) {
			const r = await register(body);
			expect(r.status, JSON.stringify(body)).toBe(400);
			const e = (await r.json()) as { error: string };
			expect(["invalid_redirect_uri", "invalid_client_metadata"]).toContain(
				e.error,
			);
		}
		const notJson = await app.request("/oauth/register", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-for": ip() },
			body: "nope",
		});
		expect(notJson.status).toBe(400);
	});

	test("10 registrations an hour per address", async () => {
		const from = "203.0.113.77";
		for (let i = 0; i < 10; i++)
			expect((await register({ redirect_uris: [REDIRECT] }, from)).status).toBe(
				201,
			);
		const r = await register({ redirect_uris: [REDIRECT] }, from);
		expect(r.status).toBe(429);
		expect(((await r.json()) as { error: string }).error).toBe("slow_down");
		expect(
			(await register({ redirect_uris: [REDIRECT] }, "203.0.113.78")).status,
		).toBe(201);
	});

	test("IPv6 addresses in one /64 share the limit; another /64 does not", async () => {
		for (let i = 0; i < 10; i++)
			expect(
				(
					await register(
						{ redirect_uris: [REDIRECT] },
						`2001:db8:aa:bb::${(i + 1).toString(16)}`,
					)
				).status,
			).toBe(201);
		expect(
			(await register({ redirect_uris: [REDIRECT] }, "2001:db8:aa:bb:1:2:3:4"))
				.status,
		).toBe(429);
		expect(
			(await register({ redirect_uris: [REDIRECT] }, "2001:db8:aa:bc::1"))
				.status,
		).toBe(201);
	});
});

describe.skipIf(!HAS_DB)("authorize", () => {
	test("a valid request is stored and the person goes to the consent page", async () => {
		const clientId = await registered();
		const r = await authorize(clientId);
		expect(r.status).toBe(302);
		const to = new URL(r.headers.get("location") ?? "");
		expect(`${to.origin}${to.pathname}`).toBe(`${WEB}/oauth/consent`);
		expect(to.searchParams.get("req")).toMatch(/^oar_/);
		// Nothing about the client rides along: the page reads it server side.
		expect([...to.searchParams.keys()]).toEqual(["req"]);
	});

	test("an unknown client or an unregistered redirect: a 400 page, never a redirect", async () => {
		const clientId = await registered("https://app.example/cb");
		const unknown = await app.request(
			authorizeUrl("ocl_nope", { redirect_uri: "https://app.example/cb" }),
		);
		expect(unknown.status).toBe(400);
		expect(unknown.headers.get("location")).toBeNull();
		expect(unknown.headers.get("content-type")).toContain("text/html");
		for (const redirect of [
			"https://app.example/cb/extra", // registered one is a prefix
			"https://app.example/c", // a prefix of the registered one
			"https://app.example/cb?x=1",
			"https://app.example/cb#frag",
			"https://user@app.example/cb",
			"http://app.example/cb",
			"https://APP.example/cb",
			"https://app.example.evil.com/cb",
		]) {
			const r = await authorize(clientId, { redirect_uri: redirect });
			expect(r.status, redirect).toBe(400);
			expect(r.headers.get("location"), redirect).toBeNull();
		}
	});

	test("the error page escapes what it shows", async () => {
		const r = await app.request(
			authorizeUrl("<script>", { redirect_uri: REDIRECT }),
		);
		const html = await r.text();
		expect(html).not.toContain("<script>");
		expect(r.headers.get("content-security-policy")).toContain(
			"default-src 'none'",
		);
	});

	test("plain PKCE, no PKCE, a wrong resource or another response type go back as errors with state and iss", async () => {
		const clientId = await registered();
		for (const [over, error] of [
			[
				{ code_challenge_method: "plain", code_challenge: VERIFIER },
				"invalid_request",
			],
			[{ code_challenge_method: null }, "invalid_request"],
			[{ code_challenge: null }, "invalid_request"],
			[{ code_challenge: "short" }, "invalid_request"],
			[{ resource: null }, "invalid_target"],
			[{ resource: "https://evil.example/mcp" }, "invalid_target"],
			[{ resource: ORIGIN }, "invalid_target"],
			[{ response_type: "token" }, "unsupported_response_type"],
		] as const) {
			const r = await authorize(
				clientId,
				over as Record<string, string | null>,
			);
			expect(r.status, JSON.stringify(over)).toBe(302);
			const back = new URL(r.headers.get("location") ?? "");
			expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
			expect(back.searchParams.get("error")).toBe(error);
			expect(back.searchParams.get("state")).toBe("st-1");
			expect(back.searchParams.get("iss")).toBe(ORIGIN);
			expect(back.searchParams.get("code")).toBeNull();
		}
	});
});

describe.skipIf(!HAS_DB)("token", () => {
	test("form-encoded is not blocked by the /api JSON rule; JSON is refused", async () => {
		const { clientId, code } = await approved();
		const json = await app.request("/oauth/token", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-for": ip() },
			body: JSON.stringify({
				grant_type: "authorization_code",
				client_id: clientId,
				code,
			}),
		});
		expect(json.status).toBe(400);
		expect(((await json.json()) as { error: string }).error).toBe(
			"invalid_request",
		);
		const r = await exchange(clientId, code);
		expect(r.status).toBe(200);
		expect(r.headers.get("cache-control")).toBe("no-store");
		const t = (await r.json()) as Tokens & {
			token_type: string;
			expires_in: number;
			scope: string;
		};
		expect(t.access_token).toStartWith("oat-sl_");
		expect(t.refresh_token).toStartWith("ort-sl_");
		expect(t.token_type).toBe("Bearer");
		expect(t.expires_in).toBe(3600);
		expect(t.scope).toBe("mcp");
	});

	test("a wrong verifier, redirect, client or resource is refused", async () => {
		const { clientId, code } = await approved();
		const other = await registered();
		for (const [over, error] of [
			[{ code_verifier: `${VERIFIER.slice(0, -1)}y` }, "invalid_grant"],
			[{ code_verifier: "short" }, "invalid_grant"],
			[{ redirect_uri: "http://127.0.0.1:53682/other" }, "invalid_grant"],
			[{ client_id: other }, "invalid_grant"],
			[{ client_id: "ocl_unknown" }, "invalid_client"],
			[{ resource: "https://evil.example/mcp" }, "invalid_target"],
		] as const) {
			const r = await exchange(clientId, code, over);
			expect(r.status, JSON.stringify(over)).toBeGreaterThanOrEqual(400);
			expect(((await r.json()) as { error: string }).error).toBe(error);
		}
		expect((await exchange(clientId, code)).status).toBe(200);
	});

	test("a code replayed: refused, and the grant it made is revoked", async () => {
		const { clientId, code } = await approved();
		const first = (await (await exchange(clientId, code)).json()) as Tokens;
		expect(
			await resolveOauthAccessToken(db, first.access_token),
		).not.toBeNull();
		const again = await exchange(clientId, code);
		expect(again.status).toBe(400);
		expect(((await again.json()) as { error: string }).error).toBe(
			"invalid_grant",
		);
		expect(await resolveOauthAccessToken(db, first.access_token)).toBeNull();
	});

	test("refresh rotates; a retired refresh token presented again revokes the grant", async () => {
		const { clientId, code } = await approved();
		const first = (await (await exchange(clientId, code)).json()) as Tokens;
		const refresh = (fields: Record<string, string> = {}) =>
			tokenRequest({
				grant_type: "refresh_token",
				client_id: clientId,
				refresh_token: first.refresh_token,
				...fields,
			});
		const rotated = await refresh();
		expect(rotated.status).toBe(200);
		const second = (await rotated.json()) as Tokens;
		expect(second.refresh_token).not.toBe(first.refresh_token);
		const reuse = await refresh();
		expect(reuse.status).toBe(400);
		expect(await resolveOauthAccessToken(db, second.access_token)).toBeNull();
		const afterRevoke = await tokenRequest({
			grant_type: "refresh_token",
			client_id: clientId,
			refresh_token: second.refresh_token,
		});
		expect(afterRevoke.status).toBe(400);
	});

	test("an unknown grant type is refused", async () => {
		const clientId = await registered();
		const r = await tokenRequest({
			grant_type: "client_credentials",
			client_id: clientId,
		});
		expect(((await r.json()) as { error: string }).error).toBe(
			"unsupported_grant_type",
		);
	});
});
