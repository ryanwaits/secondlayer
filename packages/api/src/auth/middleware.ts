import {
	OAUTH_ACCESS_PREFIX,
	resolveOauthAccessToken,
} from "@secondlayer/platform/db/queries/oauth";
import { getDb as _getDb, sql } from "@secondlayer/shared/db";
import {
	ApiKeyExpiredError,
	ApiKeyRevokedError,
	AuthenticationError,
	AuthorizationError,
} from "@secondlayer/shared/errors";
import type { Context, MiddlewareHandler } from "hono";
import { isDevMode } from "../lib/dev-mode.ts";
import { keyLiveness, liveKeyWhere } from "./key-state.ts";
import { hashToken } from "./keys.ts";
import { isMcpRequest } from "./oauth/audience.ts";
import { lookupSession } from "./session.ts";

const lastUpdatedMap = new Map<string, number>();

/**
 * Thrown when a ghost-account key (anonymous self-serve, unclaimed) attempts a
 * non-GET request on a requireAuth-gated route. Plain Error with a literal
 * code: status mapping lives in shared `CODE_TO_STATUS`, matched by code (not
 * instanceof) in the global error handler.
 */
export class GhostKeyReadOnlyError extends Error {
	code = "GHOST_KEY_READ_ONLY";
	constructor() {
		super(
			"Ghost keys are read-only. Claim your account to unlock writes (deploys, webhooks, key management).",
		);
		this.name = "GhostKeyReadOnlyError";
	}
}

export function requireAuth(opts?: {
	getDb?: typeof _getDb;
	/**
	 * Where an OAuth access token (`oat-sl_`, hosted MCP) is accepted: only
	 * routes this says yes to, and only on a request the MCP handler made in
	 * process (oauth/audience.ts). Omitted, never. Key and grant management
	 * never opt in.
	 */
	oauth?: (c: Context) => boolean;
}): MiddlewareHandler {
	const getDb = opts?.getDb ?? _getDb;
	return async (c, next) => {
		if (isDevMode()) {
			const devAuth = c.req.header("authorization");
			if (devAuth?.startsWith("Bearer ")) {
				const devRaw = devAuth.slice(7);
				const devHash = hashToken(devRaw);
				const db = getDb();
				if (devRaw.startsWith("ss-sl_")) {
					const session = await db
						.selectFrom("sessions")
						.select("account_id")
						.where("token_hash", "=", devHash)
						.executeTakeFirst();
					if (session) c.set("accountId", session.account_id);
				} else if (devRaw.startsWith("sk-sl_")) {
					const key = await db
						.selectFrom("api_keys")
						.select("account_id")
						.where("key_hash", "=", devHash)
						.where("product", "!=", "docs")
						.where(liveKeyWhere())
						.executeTakeFirst();
					if (key) c.set("accountId", key.account_id);
				}
			}
			await next();
			return;
		}

		const authHeader = c.req.header("authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			throw new AuthenticationError("Missing or invalid Authorization header");
		}

		const raw = authHeader.slice(7);
		const tokenHash = hashToken(raw);
		const db = getDb();

		if (raw.startsWith("ss-sl_")) {
			const lookup = await lookupSession(db, tokenHash);

			if (lookup.status === "not_found") {
				throw new AuthenticationError("Invalid session token");
			}
			if (lookup.status === "revoked") {
				throw new AuthorizationError("Session has been revoked");
			}
			if (lookup.status === "expired") {
				throw new AuthenticationError("Session has expired");
			}

			const session = lookup.session;
			c.set("accountId", session.account_id);
			c.set("session", session);

			const now = Date.now();
			const lastUpdated = lastUpdatedMap.get(tokenHash) ?? 0;
			if (now - lastUpdated > 60_000) {
				lastUpdatedMap.set(tokenHash, now);
				db.updateTable("sessions")
					.set({
						last_used_at: new Date(),
						expires_at: sql`NOW() + INTERVAL '90 days'`,
					})
					.where("id", "=", session.id)
					.execute()
					.catch(() => {});
			}
		} else if (raw.startsWith("sk-sl_")) {
			const keyRecord = await db
				.selectFrom("api_keys")
				.selectAll()
				.where("key_hash", "=", tokenHash)
				.executeTakeFirst();

			if (!keyRecord) {
				throw new AuthenticationError("Invalid API key");
			}

			const liveness = keyLiveness(keyRecord);
			if (liveness === "revoked") {
				if (keyRecord.product === "account") {
					c.set("revokedApiKey", {
						id: keyRecord.id,
						account_id: keyRecord.account_id,
					});
				}
				throw new ApiKeyRevokedError();
			}
			if (liveness === "expired") {
				throw new ApiKeyExpiredError();
			}

			if (keyRecord.product === "docs") {
				throw new AuthorizationError(
					"Docs keys can only read Streams and Index.",
				);
			}

			if (keyRecord.product !== "account") {
				throw new AuthenticationError("Invalid API key");
			}

			const method = c.req.method.toUpperCase();
			if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
				const owner = await db
					.selectFrom("accounts")
					.select("ghost")
					.where("id", "=", keyRecord.account_id)
					.executeTakeFirst();
				if (owner?.ghost) {
					throw new GhostKeyReadOnlyError();
				}
			}

			c.set("apiKey", keyRecord);
			c.set("accountId", keyRecord.account_id);

			const now = Date.now();
			const lastUpdated = lastUpdatedMap.get(tokenHash) ?? 0;
			if (now - lastUpdated > 60_000) {
				lastUpdatedMap.set(tokenHash, now);
				db.updateTable("api_keys")
					.set({ last_used_at: new Date() })
					.where("id", "=", keyRecord.id)
					.execute()
					.catch(() => {});
			}
		} else if (raw.startsWith(OAUTH_ACCESS_PREFIX)) {
			if (!opts?.oauth?.(c) || !isMcpRequest(c.req.raw)) {
				throw new AuthenticationError("Invalid token");
			}
			const grant = await resolveOauthAccessToken(db, raw);
			if (!grant) throw new AuthenticationError("Invalid token");
			c.set("accountId", grant.accountId);
			c.set("oauthGrantId", grant.grantId);
		} else {
			throw new AuthenticationError("Invalid token format");
		}

		await next();
	};
}
