import {
	REQUEST_ID_PATTERN,
	newRequestId,
} from "@secondlayer/shared/error-envelope";
import type { Context, MiddlewareHandler } from "hono";

export function requestId(): MiddlewareHandler {
	return async (c, next) => {
		const incoming = c.req.header("x-request-id");
		const id =
			incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : newRequestId();
		c.set("requestId", id);
		await next();
		c.header("X-Request-Id", id);
	};
}

export function getRequestId(c: Context): string | undefined {
	return c.get("requestId") as string | undefined;
}
