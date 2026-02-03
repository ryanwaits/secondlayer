import type { MiddlewareHandler } from "hono";
import { hashToken } from "./keys.ts";
import { getDb as _getDb, sql } from "@secondlayer/shared/db";
import { AuthenticationError, AuthorizationError } from "@secondlayer/shared/errors";

// Debounce last_used_at updates: tokenHash → last DB write timestamp
const lastUpdatedMap = new Map<string, number>();

export function requireAuth(opts?: { getDb?: typeof _getDb }): MiddlewareHandler {
  const getDb = opts?.getDb ?? _getDb;
  return async (c, next) => {
    // DEV_MODE bypass — local dev without auth
    if (process.env.DEV_MODE === "true") {
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
