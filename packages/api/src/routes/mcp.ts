import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createApiRequest, createServer } from "@secondlayer/mcp";
import {
	OAUTH_ACCESS_PREFIX,
	resolveOauthAccessToken,
} from "@secondlayer/platform/db/queries/oauth";
import { SecondLayer } from "@secondlayer/sdk";
import { getDb } from "@secondlayer/shared/db";
import { type Context, Hono } from "hono";
import { getClientIp } from "../auth/http.ts";
import { liveKeyWhere } from "../auth/key-state.ts";
import { hashToken } from "../auth/keys.ts";
import { markMcpRequest } from "../auth/oauth/audience.ts";
import { issuerOrigin, mcpChallenge } from "../auth/oauth/config.ts";
import { isStreamingPath } from "./batch.ts";

/**
 * The hosted MCP endpoint, `POST /mcp`: Streamable HTTP, stateless. Every
 * request gets its own server, bound to that request's bearer, answers and is
 * closed. No session map, so any API replica can answer any request.
 *
 * The bearer is an account key (`sk-sl_`) or an OAuth access token
 * (`oat-sl_`, see auth/oauth/). Each tool call is dispatched back into this
 * app in process, with the caller's IP, so auth, rate limits, the credits
 * gate and metering apply exactly as on a direct read. Those in-process
 * requests are the only ones marked (auth/oauth/audience.ts), so an OAuth
 * token works there and nowhere else.
 *
 * No bearer: `initialize`, `tools/list`, `ping` and notifications are
 * answered, so anyone (or an agent choosing a server) sees what it does before
 * signing up. Anything else, tool calls included, is 401 with
 * `WWW-Authenticate` naming the protected-resource metadata, so a client like
 * Claude Code runs the browser sign-in. A bearer that does not resolve is 401
 * on every method.
 */

const MAX_BODY_BYTES = 1024 * 1024;

/** In-process paths a hosted tool may reach: the read planes, the Streams
 *  signing key, and the account identity for `account_whoami`. Never key or
 *  grant management, never `/mcp` itself. */
function allowedInnerPath(path: string): boolean {
	if (isStreamingPath(path)) return false;
	return (
		path.startsWith("/v1/") ||
		path === "/api/accounts/me" ||
		path === "/public/streams/signing-key"
	);
}

const bearerOf = (c: Context) =>
	c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];

/** True when `token` is a credential the hosted MCP takes: a live account
 *  key or a live OAuth access token. */
async function credentialIsLive(token: string): Promise<boolean> {
	if (token.startsWith(OAUTH_ACCESS_PREFIX)) {
		return (await resolveOauthAccessToken(getDb(), token)) !== null;
	}
	if (!token.startsWith("sk-sl_")) return false;
	const key = await getDb()
		.selectFrom("api_keys")
		.select("id")
		.where("key_hash", "=", hashToken(token))
		.where("product", "=", "account")
		.where(liveKeyWhere())
		.executeTakeFirst();
	return key !== undefined;
}

function unauthorized(c: Context, invalid: boolean) {
	c.header("WWW-Authenticate", mcpChallenge(issuerOrigin(), invalid));
	return c.json(
		{
			error: invalid
				? "Invalid or expired token. Sign in again."
				: "Sign in (OAuth), or send Authorization: Bearer <sk-sl_ key>.",
			code: "UNAUTHORIZED",
		},
		401,
	);
}

/** Methods that describe the server and touch no account data. */
const OPEN_METHODS = new Set(["initialize", "ping", "tools/list"]);

/** True when every JSON-RPC message in `body` is an open method or a
 *  notification. Unparseable: false. */
function anonymousAllowed(body: ArrayBuffer): boolean {
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(body));
	} catch {
		return false;
	}
	const messages = Array.isArray(parsed) ? parsed : [parsed];
	return (
		messages.length > 0 &&
		messages.every((m) => {
			if (typeof m !== "object" || m === null) return false;
			const method = (m as { method?: unknown }).method;
			return (
				typeof method === "string" &&
				(OPEN_METHODS.has(method) || method.startsWith("notifications/"))
			);
		})
	);
}

const signInFirst = (): never => {
	throw new Error("Sign in to call tools.");
};

/** The dumps manifest lives off the API (a public bucket): its one origin
 *  is fetched over the network, nothing else is. */
function dumpsOrigin(): string | null {
	const raw = process.env.STREAMS_BULK_PUBLIC_BASE_URL?.trim();
	if (!raw) return null;
	try {
		return new URL(raw).origin;
	} catch {
		return null;
	}
}

/** Answers one POST with `server`, then closes both ends. */
async function serve(
	c: Context,
	body: ArrayBuffer,
	server: ReturnType<typeof createServer>,
): Promise<Response> {
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	try {
		await server.connect(transport);
		return await transport.handleRequest(
			new Request(c.req.url, {
				method: "POST",
				headers: c.req.raw.headers,
				body,
			}),
		);
	} finally {
		await transport.close();
		await server.close();
	}
}

export function createMcpRouter(
	dispatch: (req: Request) => Promise<Response>,
): Hono {
	const app = new Hono();

	app.post("/", async (c) => {
		const token = bearerOf(c);
		if (token && !(await credentialIsLive(token))) return unauthorized(c, true);

		if (Number(c.req.header("content-length") ?? 0) > MAX_BODY_BYTES)
			return c.json(
				{ error: "Body over 1 MB.", code: "PAYLOAD_TOO_LARGE" },
				413,
			);
		const body = await c.req.arrayBuffer();
		if (body.byteLength > MAX_BODY_BYTES)
			return c.json(
				{ error: "Body over 1 MB.", code: "PAYLOAD_TOO_LARGE" },
				413,
			);
		if (!token) {
			if (!anonymousAllowed(body)) return unauthorized(c, false);
			// No credential to bind: a tool reaching for one is a bug, and fails.
			return serve(
				c,
				body,
				createServer({
					hosted: true,
					clientProvider: signInFirst,
					archiveOpsClientProvider: signInFirst,
					apiRequest: signInFirst,
				}),
			);
		}

		const origin = issuerOrigin();
		const callerIp = getClientIp(c);
		const dumps = dumpsOrigin();
		const inProcess = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (dumps && url.origin === dumps) return fetch(url, init);
			if (
				url.origin !== new URL(origin).origin ||
				!allowedInnerPath(url.pathname)
			)
				return Response.json(
					{ error: "Not reachable from the hosted MCP.", code: "FORBIDDEN" },
					{ status: 403 },
				);
			const headers = new Headers(init?.headers);
			// Rate limits and logs key on the real caller, not this dispatcher.
			headers.set("x-forwarded-for", callerIp);
			const inner = new Request(url.toString(), { ...init, headers });
			markMcpRequest(inner);
			return dispatch(inner);
		}) as typeof fetch;

		const client = new SecondLayer({
			apiKey: token,
			baseUrl: origin,
			origin: "mcp",
			fetchImpl: inProcess,
			// A fresh client per request: nothing cached across callers.
			etagCache: false,
			...(process.env.STREAMS_BULK_PUBLIC_BASE_URL
				? { dumpsBaseUrl: process.env.STREAMS_BULK_PUBLIC_BASE_URL }
				: {}),
		});
		return serve(
			c,
			body,
			createServer({
				hosted: true,
				clientProvider: () => client,
				archiveOpsClientProvider: () => client,
				apiRequest: createApiRequest({
					baseUrl: origin,
					apiKey: token,
					fetchImpl: inProcess,
				}),
			}),
		);
	});

	// Stateless: there is no SSE stream to open and no session to delete.
	app.on(["GET", "DELETE", "PUT", "PATCH"], "/", (c) =>
		c.json({ error: "Use POST.", code: "METHOD_NOT_ALLOWED" }, 405, {
			Allow: "POST",
		}),
	);

	return app;
}
