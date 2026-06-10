import { getDb as _getDb, sql } from "@secondlayer/shared/db";
import {
	AuthenticationError,
	AuthorizationError,
} from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { isDevMode } from "../lib/dev-mode.ts";
import { hashToken } from "./keys.ts";

// Debounce last_used_at updates: tokenHash → last DB write timestamp
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
			"Ghost keys are read-only. Claim your account to unlock writes (deploys, subscriptions, key management).",
		);
		this.name = "GhostKeyReadOnlyError";
	}
}

export function requireAuth(opts?: {
	getDb?: typeof _getDb;
}): MiddlewareHandler {
	const getDb = opts?.getDb ?? _getDb;
	return async (c, next) => {
		// DEV_MODE bypass — local dev without auth. Forced false in
		// `NODE_ENV=production` by `isDevMode()`.
		if (isDevMode()) {
			// Still try to resolve accountId from token if present
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
			// Session token flow
			const session = await db
				.selectFrom("sessions")
				.selectAll()
				.where("token_hash", "=", tokenHash)
				.executeTakeFirst();

			if (!session) {
				throw new AuthenticationError("Invalid session token");
			}

			if (session.revoked_at) {
				throw new AuthorizationError("Session has been revoked");
			}

			if (new Date(session.expires_at) < new Date()) {
				throw new AuthenticationError("Session has expired");
			}

			c.set("accountId", session.account_id);
			c.set("session", session);

			// Debounced last_used_at + sliding window expiry extension
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
					.catch(() => {}); // fire-and-forget
			}
		} else if (raw.startsWith("sk-sl_")) {
			// API key flow
			const keyRecord = await db
				.selectFrom("api_keys")
				.selectAll()
				.where("key_hash", "=", tokenHash)
				.executeTakeFirst();

			if (!keyRecord) {
				throw new AuthenticationError("Invalid API key");
			}

			if (keyRecord.status === "revoked") {
				throw new AuthorizationError("API key has been revoked");
			}

			if (keyRecord.status !== "active") {
				throw new AuthenticationError("Invalid API key");
			}

			// Ghost guard: keys owned by an unclaimed ghost account are read-only.
			// Only checked on mutating methods, so the hot GET path pays nothing;
			// for writes it's one indexed PK read on accounts — acceptable.
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

			// Debounced last_used_at update
			const now = Date.now();
			const lastUpdated = lastUpdatedMap.get(tokenHash) ?? 0;
			if (now - lastUpdated > 60_000) {
				lastUpdatedMap.set(tokenHash, now);
				db.updateTable("api_keys")
					.set({ last_used_at: new Date() })
					.where("id", "=", keyRecord.id)
					.execute()
					.catch(() => {}); // fire-and-forget
			}
		} else {
			throw new AuthenticationError("Invalid token format");
		}

		await next();
	};
}
