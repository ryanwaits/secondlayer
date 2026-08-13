import { AuthenticationError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { resolveInstanceToken } from "../instance-bind.ts";

/**
 * OSS-mode auth factories.
 *
 * - `noAuth()` — pass-through; no auth context set.
 * - `instanceTokenAuth()` — pass-through when no instance token is set;
 *   otherwise requires `Authorization: Bearer $INSTANCE_TOKEN` (API_KEY alias).
 *
 * Platform mode uses `requireAuth()` from `packages/api/src/auth` directly.
 */

const SKIP_PREFIXES = ["/health", "/public"];

export function shouldSkipInstanceAuth(path: string): boolean {
	return SKIP_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(`${prefix}/`),
	);
}

/** Pass-through middleware — used in OSS mode when no key is configured. */
export function noAuth(): MiddlewareHandler {
	return async (_c, next) => {
		await next();
	};
}

/**
 * Shared instance token. Unset → open (only legal on a loopback bind).
 * `API_KEY` is accepted as an alias of `INSTANCE_TOKEN`.
 */
export function instanceTokenAuth(): MiddlewareHandler {
	return async (c, next) => {
		if (shouldSkipInstanceAuth(c.req.path)) {
			await next();
			return;
		}
		const expected = resolveInstanceToken();
		if (!expected) {
			await next();
			return;
		}
		const auth = c.req.header("authorization");
		if (!auth?.startsWith("Bearer ")) {
			throw new AuthenticationError("Missing or invalid Authorization header");
		}
		const provided = auth.slice(7);
		if (provided !== expected) {
			throw new AuthenticationError("Invalid instance token");
		}
		await next();
	};
}

/** @deprecated Use `instanceTokenAuth`. */
export function staticKeyAuth(): MiddlewareHandler {
	return instanceTokenAuth();
}
