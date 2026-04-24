import { logger } from "@secondlayer/shared";
import type { Context, Next } from "hono";

/**
 * Request logging middleware
 * Logs incoming requests and response times
 */
export async function requestLogger(c: Context, next: Next) {
	const start = Date.now();
	const method = c.req.method;
	const path = c.req.path;

	// Log request
	logger.debug("Incoming request", { method, path });

	await next();

	// Log response
	const duration = Date.now() - start;
	const status = c.res.status;

	if (status >= 500) {
		logger.error("Request failed", { method, path, status, duration });
	} else {
		// 4xx is info — scanner probes (`/.env`, `/.git/HEAD`) generate a
		// steady stream of 404s that shouldn't surface as warnings. If a
		// specific 4xx matters (auth failure, validation), the handler
		// should log it explicitly at its own level.
		logger.info("Request completed", { method, path, status, duration });
	}
}
