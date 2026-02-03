import type { Context, Next } from "hono";
import { logger } from "@secondlayer/shared";

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
  } else if (status >= 400) {
    logger.warn("Request error", { method, path, status, duration });
  } else {
    logger.info("Request completed", { method, path, status, duration });
  }
}
