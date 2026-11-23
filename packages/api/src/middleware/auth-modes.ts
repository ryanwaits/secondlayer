import type { MiddlewareHandler } from "hono";
import {
	bearerToken,
	invalidCredentialError,
	missingCredentialError,
} from "../auth/read-plane.ts";
import {
	instanceTokenMatches,
	resolveInstanceToken,
} from "../instance-bind.ts";

const SKIP_PREFIXES = ["/health", "/public"];

export function shouldSkipInstanceAuth(path: string): boolean {
	return SKIP_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(`${prefix}/`),
	);
}

export function noAuth(): MiddlewareHandler {
	return async (_c, next) => {
		await next();
	};
}

/**
 * Shared instance token. Unset → open (only legal on a loopback bind).
 * `API_KEY` is accepted as an alias of `INSTANCE_TOKEN`.
 *
 * Mounted on the write plane (`/api/subgraphs`, `/api/webhooks`,
 * `/api/node`) and `/status`, never on `/v1` — the read plane's rule lives in
 * `auth/read-plane.ts` and keeps loopback reads keyless.
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
		const provided = bearerToken(c);
		if (provided === null) throw missingCredentialError();
		if (!instanceTokenMatches(provided)) throw invalidCredentialError();
		await next();
	};
}
