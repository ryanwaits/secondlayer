import {
	approveOauthRequest,
	denyOauthRequest,
	getOpenOauthRequest,
	listOauthGrants,
	revokeOauthGrant,
} from "@secondlayer/platform/db/queries/oauth";
import { getDb } from "@secondlayer/shared/db";
import { AuthorizationError, NotFoundError } from "@secondlayer/shared/errors";
import { Hono, type MiddlewareHandler } from "hono";
import { requireAuth } from "../auth/middleware.ts";
import { issuerOrigin } from "../auth/oauth/config.ts";
import { redirectWith } from "../auth/oauth/routes.ts";

/**
 * The web consent page's side of the hosted MCP sign-in, and the account's
 * connected apps. A signed-in browser session only: an API key or an OAuth
 * token is refused with 403 before it is even looked up, in process or not,
 * so no key and no app can approve a sign-in or list, mint or revoke a grant.
 */

const REQUEST_ID_RE = /^oar_[A-Za-z0-9_-]{1,64}$/;
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only a session bearer gets as far as `requireAuth`. */
const sessionBearerOnly: MiddlewareHandler = async (c, next) => {
	const header = c.req.header("authorization");
	if (header?.startsWith("Bearer ") && !header.slice(7).startsWith("ss-sl_")) {
		throw new AuthorizationError(
			"Connected apps are managed from a signed-in browser session, not an API key or an app's token.",
		);
	}
	await next();
};

/** The account behind a session (requireAuth has run). */
function sessionAccount(c: { get(key: string): unknown }): string {
	if (!c.get("session")) {
		throw new AuthorizationError(
			"Connected apps are managed from a signed-in browser session.",
		);
	}
	return c.get("accountId") as string;
}

function requestId(raw: string): string {
	if (!REQUEST_ID_RE.test(raw))
		throw new NotFoundError("Unknown or expired sign-in request");
	return raw;
}

const app = new Hono();
app.use("*", sessionBearerOnly);
app.use("*", requireAuth());

// What the consent page shows for a request still waiting for an answer.
app.get("/requests/:id", async (c) => {
	sessionAccount(c);
	const r = await getOpenOauthRequest(getDb(), requestId(c.req.param("id")));
	if (!r) throw new NotFoundError("Unknown or expired sign-in request");
	c.header("Cache-Control", "no-store");
	return c.json({
		id: r.id,
		clientName: r.clientName,
		redirectHost: new URL(r.redirectUri).host,
		expiresAt: r.expiresAt.toISOString(),
	});
});

// Allow: a one-time code goes back to the app's registered redirect.
app.post("/requests/:id/approve", async (c) => {
	const accountId = sessionAccount(c);
	const ok = await approveOauthRequest(
		getDb(),
		requestId(c.req.param("id")),
		accountId,
	);
	if (!ok) throw new NotFoundError("Unknown or expired sign-in request");
	c.header("Cache-Control", "no-store");
	return c.json({
		redirect: redirectWith(
			ok.redirectUri,
			{ code: ok.code, state: ok.state },
			issuerOrigin(),
		),
	});
});

// Deny: the app gets `access_denied`.
app.post("/requests/:id/deny", async (c) => {
	const accountId = sessionAccount(c);
	const ok = await denyOauthRequest(
		getDb(),
		requestId(c.req.param("id")),
		accountId,
	);
	if (!ok) throw new NotFoundError("Unknown or expired sign-in request");
	return c.json({
		redirect: redirectWith(
			ok.redirectUri,
			{
				error: "access_denied",
				error_description: "The person declined.",
				state: ok.state,
			},
			issuerOrigin(),
		),
	});
});

// Connected apps, for the keys page.
app.get("/grants", async (c) => {
	const accountId = sessionAccount(c);
	const grants = await listOauthGrants(getDb(), accountId);
	return c.json({
		grants: grants.map((g) => ({
			id: g.id,
			clientName: g.clientName,
			createdAt: g.createdAt.toISOString(),
			lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
		})),
	});
});

// Revoke: its tokens stop working at once.
app.delete("/grants/:id", async (c) => {
	const accountId = sessionAccount(c);
	const id = c.req.param("id");
	if (!UUID_RE.test(id) || !(await revokeOauthGrant(getDb(), id, accountId)))
		throw new NotFoundError("Unknown app");
	return c.json({ revoked: id });
});

export default app;
