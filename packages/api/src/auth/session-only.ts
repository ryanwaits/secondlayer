import { AuthorizationError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";

/**
 * Refuses a request that did not come with a signed-in session (`ss-sl_`),
 * after `requireAuth` has run. An account API key (`sk-sl_`) authenticates the
 * read planes and nothing that moves money or changes how the account is
 * charged: a leaked key must not be able to retarget the saved card.
 */
export function sessionOnly(): MiddlewareHandler {
	return async (c, next) => {
		if (!c.get("session")) {
			throw new AuthorizationError(
				"Billing changes need a signed-in session, not an API key. Sign in at secondlayer.tools or run `secondlayer login`.",
			);
		}
		await next();
	};
}
