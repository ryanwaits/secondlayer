import { AuthorizationError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";

/**
 * Refuses a request that did not come with a signed-in session (`ss-sl_`),
 * after `requireAuth` has run. Used on the writes that change what the saved
 * card is charged (auto-refill, spend cap): a leaked account API key must not
 * be able to retarget it.
 */
export function sessionOnly(): MiddlewareHandler {
	return async (c, next) => {
		if (!c.get("session")) {
			throw new AuthorizationError(
				"Changing auto-refill or the spend cap needs a signed-in session, not an API key. Sign in at secondlayer.tools or run `secondlayer login`.",
			);
		}
		await next();
	};
}
