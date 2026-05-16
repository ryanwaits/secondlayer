import { AuthenticationError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";

/**
 * OSS-mode auth factories.
 *
 * - `noAuth()` — pass-through; no auth context set.
 * - `staticKeyAuth(key)` — pass-through when `API_KEY` env is unset; otherwise
 *   requires `Authorization: Bearer $API_KEY`.
 *
 * Platform mode uses `requireAuth()` from `packages/api/src/auth` directly.
 */

/** Pass-through middleware — used in OSS mode when no key is configured. */
export function noAuth(): MiddlewareHandler {
	return async (_c, next) => {
		await next();
	};
}

/**
 * Simple shared-key auth for OSS instances that want a password gate.
 * When `API_KEY` is unset or empty, behaves like `noAuth()`.
 */
export function staticKeyAuth(): MiddlewareHandler {
	return async (c, next) => {
		const expected = process.env.API_KEY?.trim();
		if (!expected) {
			// No key configured → pass through (same as noAuth).
			await next();
			return;
		}
		const auth = c.req.header("authorization");
		if (!auth?.startsWith("Bearer ")) {
			throw new AuthenticationError("Missing or invalid Authorization header");
		}
		const provided = auth.slice(7);
		if (provided !== expected) {
			throw new AuthenticationError("Invalid API key");
		}
		await next();
	};
}

