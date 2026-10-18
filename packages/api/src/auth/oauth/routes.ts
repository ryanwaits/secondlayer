import {
	OAUTH_SCOPE,
	createOauthRequest,
	exchangeOauthCode,
	getOauthClient,
	refreshOauthTokens,
	registerOauthClient,
} from "@secondlayer/platform/db/queries/oauth";
import { getDb } from "@secondlayer/shared/db";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { getClientIp } from "../http.ts";
import { getRateLimitStore } from "../rate-limit-store.ts";
import { consentWebUrl, issuerOrigin, resourceOf } from "./config.ts";
import { allowedRedirect, clientNameProblem, rateKeyOf } from "./validate.ts";

/**
 * OAuth 2.1 for the hosted MCP endpoint. The API is both the authorization
 * server and the protected resource (`<origin>/mcp`). A client registers
 * itself (DCR, RFC 7591; public clients only), sends the person to
 * `/oauth/authorize`, which hands them to the web consent page, and swaps the
 * one-time code for tokens at `/oauth/token`.
 *
 *   - PKCE S256 only. `redirect_uri` is matched exactly against the
 *     registered list. Every authorize refusal is a 400 page, never a
 *     redirect; only the consent page's answer (approve or deny) goes back
 *     to the registered URI, with `state` and `iss`.
 *   - `resource` (RFC 8707) is required and must be `<origin>/mcp`.
 *   - Mounted at the root, outside `/api`: CORS `*` with no credentials, and
 *     the token endpoint is form-encoded, which `/api`'s JSON-only write rule
 *     would refuse. No cookies, so no CSRF.
 *   - The issuer comes from `API_PUBLIC_URL` (config.ts), never from Host.
 *
 * The stored side (codes, tokens, rotation, revocation) is
 * `@secondlayer/platform/db/queries/oauth`.
 */

const REGISTER_PER_HOUR = 10;
const AUTHORIZE_PER_MIN = 30;
const TOKEN_PER_MIN = 60;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_STATE = 512;
/** RFC 7636 §4.1: 43–128 unreserved characters. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
/** BASE64URL(SHA256(verifier)) is always 43 characters. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export const OAUTH_PATHS = [
	"/.well-known/oauth-authorization-server",
	"/.well-known/oauth-protected-resource",
	"/.well-known/oauth-protected-resource/mcp",
	"/oauth/register",
	"/oauth/authorize",
	"/oauth/token",
] as const;

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** CORS for the OAuth endpoints and `/mcp`: any origin, never credentials. */
export const oauthCors = cors({
	origin: "*",
	credentials: false,
	allowMethods: ["GET", "POST", "OPTIONS"],
	allowHeaders: ["Content-Type", "Authorization", "Mcp-Protocol-Version"],
	exposeHeaders: ["WWW-Authenticate"],
	maxAge: 86400,
});

function oauthError(
	c: Context,
	error: string,
	description: string,
	status: 400 | 401 | 429 = 400,
) {
	return c.json({ error, error_description: description }, status, NO_STORE);
}

const escapeHtml = (s: string) =>
	s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A plain page for an authorize request that can't be sent back to the
 *  client (unknown client or redirect): never a redirect. */
function errorPage(message: string, status = 400) {
	return new Response(
		`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Sign-in error</title><p>${escapeHtml(message)}</p>`,
		{
			status,
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"X-Frame-Options": "DENY",
				"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
				...NO_STORE,
			},
		},
	);
}

/** `redirect_uri` plus the answer, `state` and `iss` (RFC 9207). */
export function redirectWith(
	redirectUri: string,
	params: Record<string, string | null>,
	origin: string,
): string {
	const u = new URL(redirectUri);
	for (const [k, v] of Object.entries(params))
		if (v !== null) u.searchParams.set(k, v);
	u.searchParams.set("iss", origin);
	return u.toString();
}

/** True when this caller (IPv6 by /64) has used up `limit` in `windowMs`.
 *  Fails closed if the shared store is down: these are abuse-sensitive. */
async function limited(
	c: Context,
	scope: string,
	limit: number,
	windowMs: number,
): Promise<boolean> {
	const key = `oauth:${scope}:${rateKeyOf(getClientIp(c))}`;
	const r = await getRateLimitStore().check(key, limit, windowMs, {
		failClosed: true,
	});
	if (!r.allowed) c.header("Retry-After", String(r.retryAfter));
	return !r.allowed;
}

async function readBody(c: Context): Promise<string | null> {
	const declared = Number(c.req.header("content-length") ?? 0);
	if (declared > MAX_BODY_BYTES) return null;
	const text = await c.req.text().catch(() => null);
	return text !== null && text.length <= MAX_BODY_BYTES ? text : null;
}

const isStrings = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every((x) => typeof x === "string");

function protectedResource(c: Context, origin: string, resource: string) {
	return c.json({
		resource,
		authorization_servers: [origin],
		scopes_supported: [OAUTH_SCOPE],
		bearer_methods_supported: ["header"],
		resource_name: "secondlayer",
		resource_documentation: `${consentWebUrl()}/docs/mcp`,
	});
}

export function createOauthRouter(): Hono {
	const app = new Hono();
	for (const path of OAUTH_PATHS) app.use(path, oauthCors);

	app.get("/.well-known/oauth-protected-resource", (c) =>
		protectedResource(c, issuerOrigin(), issuerOrigin()),
	);
	app.get("/.well-known/oauth-protected-resource/mcp", (c) =>
		protectedResource(c, issuerOrigin(), resourceOf(issuerOrigin())),
	);
	app.get("/.well-known/oauth-authorization-server", (c) => {
		const origin = issuerOrigin();
		return c.json({
			issuer: origin,
			authorization_endpoint: `${origin}/oauth/authorize`,
			token_endpoint: `${origin}/oauth/token`,
			registration_endpoint: `${origin}/oauth/register`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none"],
			scopes_supported: [OAUTH_SCOPE],
			authorization_response_iss_parameter_supported: true,
			service_documentation: `${consentWebUrl()}/docs/mcp`,
		});
	});

	app.post("/oauth/register", async (c) => {
		if (await limited(c, "register", REGISTER_PER_HOUR, 60 * 60 * 1000))
			return oauthError(
				c,
				"slow_down",
				"Too many registrations from this address. Try again later.",
				429,
			);
		const text = await readBody(c);
		let b: Record<string, unknown> | null = null;
		try {
			const parsed = text ? JSON.parse(text) : null;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
				b = parsed as Record<string, unknown>;
		} catch {
			b = null;
		}
		if (!b)
			return oauthError(c, "invalid_client_metadata", "Send a JSON object.");
		const uris = b.redirect_uris;
		if (!isStrings(uris) || uris.length < 1 || uris.length > 10)
			return oauthError(
				c,
				"invalid_redirect_uri",
				"redirect_uris: 1 to 10 URLs.",
			);
		if (uris.some((u) => !allowedRedirect(u)))
			return oauthError(
				c,
				"invalid_redirect_uri",
				"Each redirect URI must be https, or http on 127.0.0.1, localhost or [::1], with no fragment or userinfo, up to 512 characters.",
			);
		if ((b.token_endpoint_auth_method ?? "none") !== "none")
			return oauthError(
				c,
				"invalid_client_metadata",
				"Only public clients: token_endpoint_auth_method none.",
			);
		const grants = b.grant_types ?? ["authorization_code", "refresh_token"];
		if (
			!isStrings(grants) ||
			grants.some((g) => g !== "authorization_code" && g !== "refresh_token")
		)
			return oauthError(
				c,
				"invalid_client_metadata",
				"grant_types: authorization_code, refresh_token.",
			);
		const responses = b.response_types ?? ["code"];
		if (!isStrings(responses) || responses.some((r) => r !== "code"))
			return oauthError(c, "invalid_client_metadata", "response_types: code.");
		const name = b.client_name ?? "Unnamed app";
		const problem = clientNameProblem(name);
		if (problem) return oauthError(c, "invalid_client_metadata", problem);

		const client = await registerOauthClient(getDb(), {
			name: name as string,
			redirectUris: [...new Set(uris)],
			ip: getClientIp(c),
		});
		return c.json(
			{
				client_id: client.id,
				client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
				client_name: name,
				redirect_uris: [...new Set(uris)],
				token_endpoint_auth_method: "none",
				grant_types: grants,
				response_types: responses,
			},
			201,
			NO_STORE,
		);
	});

	app.get("/oauth/authorize", async (c) => {
		if (await limited(c, "authorize", AUTHORIZE_PER_MIN, 60_000))
			return errorPage(
				"Too many sign-in attempts from this address. Try again in a minute.",
				429,
			);
		const origin = issuerOrigin();
		const q = new URL(c.req.url).searchParams;
		// The client and its exact redirect first: until both check out,
		// nothing goes back to any URL.
		const client = await getOauthClient(getDb(), q.get("client_id") ?? "");
		if (!client)
			return errorPage(
				"Unknown app. It needs to register with secondlayer again.",
			);
		const redirectUri = q.get("redirect_uri") ?? "";
		if (!client.redirectUris.includes(redirectUri))
			return errorPage(
				"This app's redirect address does not match the one it registered.",
			);
		// Every refusal before consent is a page here, never a redirect: a
		// registered redirect is still a URL anyone can register, so sending
		// errors to it would make this endpoint a redirector. Only the
		// person's answer on the consent page goes back to the app.
		const state = q.get("state");
		if (state !== null && state.length > MAX_STATE)
			return errorPage("This sign-in request is malformed: state is too long.");
		if (q.get("response_type") !== "code")
			return errorPage(
				"This app sent an unsupported request: only response_type=code.",
			);
		const challenge = q.get("code_challenge") ?? "";
		if (
			q.get("code_challenge_method") !== "S256" ||
			!CHALLENGE_RE.test(challenge)
		)
			return errorPage(
				"This app's sign-in is missing PKCE: code_challenge with code_challenge_method=S256 is required.",
			);
		const resource = resourceOf(origin);
		if (q.get("resource") !== resource)
			return errorPage(
				`This app asked for the wrong resource: it must be ${resource}.`,
			);

		// One scope: an unknown scope is ignored, not an error (D10).
		const requestId = await createOauthRequest(getDb(), {
			clientId: client.id,
			redirectUri,
			state,
			codeChallenge: challenge,
			resource,
		});
		return new Response(null, {
			status: 302,
			headers: {
				Location: `${consentWebUrl()}/oauth/consent?req=${encodeURIComponent(requestId)}`,
				...NO_STORE,
			},
		});
	});

	app.post("/oauth/token", async (c) => {
		if (await limited(c, "token", TOKEN_PER_MIN, 60_000))
			return oauthError(
				c,
				"slow_down",
				"Too many token requests. Try again in a minute.",
				429,
			);
		if (
			!(c.req.header("content-type") ?? "").includes(
				"application/x-www-form-urlencoded",
			)
		)
			return oauthError(
				c,
				"invalid_request",
				"Send application/x-www-form-urlencoded.",
			);
		const text = await readBody(c);
		if (text === null)
			return oauthError(c, "invalid_request", "The body is too large.");
		const f = new URLSearchParams(text);
		const db = getDb();
		const clientId = f.get("client_id") ?? "";
		if (!(await getOauthClient(db, clientId)))
			return oauthError(c, "invalid_client", "Unknown client_id.", 401);
		const resource = f.get("resource");
		const expected = resourceOf(issuerOrigin());
		if (resource !== null && resource !== expected)
			return oauthError(c, "invalid_target", `resource must be ${expected}.`);

		const grantType = f.get("grant_type");
		let result: Awaited<ReturnType<typeof exchangeOauthCode>>;
		if (grantType === "authorization_code") {
			const verifier = f.get("code_verifier") ?? "";
			if (!VERIFIER_RE.test(verifier))
				return oauthError(
					c,
					"invalid_grant",
					"code_verifier must be 43 to 128 unreserved characters.",
				);
			result = await exchangeOauthCode(db, {
				code: f.get("code") ?? "",
				clientId,
				redirectUri: f.get("redirect_uri") ?? "",
				codeVerifier: verifier,
				resource,
			});
		} else if (grantType === "refresh_token") {
			result = await refreshOauthTokens(db, {
				refreshToken: f.get("refresh_token") ?? "",
				clientId,
			});
		} else {
			return oauthError(
				c,
				"unsupported_grant_type",
				"grant_type: authorization_code or refresh_token.",
			);
		}
		if (!result.ok)
			return oauthError(c, result.error.error, result.error.error_description);
		return c.json(result.tokens, 200, NO_STORE);
	});

	for (const path of OAUTH_PATHS)
		app.all(path, (c) =>
			c.json({ error: "Method not allowed." }, 405, {
				Allow:
					path === "/oauth/register" || path === "/oauth/token"
						? "POST"
						: "GET",
			}),
		);

	return app;
}
