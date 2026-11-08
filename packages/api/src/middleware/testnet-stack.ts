import { ForbiddenError } from "@secondlayer/shared/errors";
import { isTestnetWebhookStack } from "@secondlayer/shared/mode";
import type { MiddlewareHandler } from "hono";

/** Header the workload gateway sets, from the introspected key, on requests to
 *  the shared testnet stack. Never set for any other stack. */
export const ACCOUNT_SCOPE_HEADER = "x-secondlayer-account-id";

/** The only surface the shared testnet stack serves, plus the liveness probe
 *  its container healthcheck hits. */
function isTestnetStackPath(path: string): boolean {
	return (
		path === "/health" ||
		path === "/api/webhooks" ||
		path.startsWith("/api/webhooks/")
	);
}

/**
 * Keeps the per-account webhook scope from failing open.
 *
 * Scope exists only when `TESTNET_WEBHOOK_STACK=true`. A request carrying the
 * account header on a stack without the flag would be read as an unscoped
 * single-tenant call and see every webhook, so it is refused outright; plain
 * tenant stacks never receive the header (the gateway strips it everywhere
 * but the testnet path), so their traffic is unchanged. On the testnet stack
 * itself only webhook routes answer: everything else would run against a
 * database holding many accounts' webhooks with no account to scope it by.
 */
export function testnetStackGuard(): MiddlewareHandler {
	return async (c, next) => {
		if (isTestnetWebhookStack()) {
			if (!isTestnetStackPath(c.req.path)) {
				throw new ForbiddenError("The testnet stack serves webhooks only");
			}
		} else if (c.req.header(ACCOUNT_SCOPE_HEADER) !== undefined) {
			throw new ForbiddenError(
				"Account-scoped requests are only served by the testnet stack",
			);
		}
		await next();
	};
}
