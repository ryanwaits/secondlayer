import { logger } from "@secondlayer/shared";
import { createWebhookHeaders } from "./signing.ts";
import type { WebhookPayload } from "./payload.ts";

export interface DispatchResult {
  success: boolean;
  statusCode?: number;
  responseTimeMs: number;
  attempts: number;
  error?: string;
}

export interface DispatchOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number[];
}

const DEFAULT_OPTIONS: Required<DispatchOptions> = {
  maxAttempts: 3,
  timeoutMs: 10000,
  retryDelayMs: [1000, 5000, 10000],
};

/**
 * Dispatch a webhook with retry logic
 */
export async function dispatchWebhook(
  url: string,
  payload: WebhookPayload,
  secret: string | null,
  options: DispatchOptions = {}
): Promise<DispatchResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const payloadStr = JSON.stringify(payload);
  const headers = createWebhookHeaders(payloadStr, secret);

  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseTimeMs = Date.now() - startTime;
      lastStatusCode = response.status;

      // Success (2xx)
      if (response.ok) {
        logger.debug("Webhook delivered", {
          url,
          statusCode: response.status,
          attempt,
          responseTimeMs,
        });

        return {
          success: true,
          statusCode: response.status,
          responseTimeMs,
          attempts: attempt,
        };
      }

      // Client error (4xx) - don't retry
      if (response.status >= 400 && response.status < 500) {
        const errorText = await response.text().catch(() => "Unknown error");
        lastError = `HTTP ${response.status}: ${errorText.slice(0, 200)}`;

        logger.warn("Webhook rejected (4xx)", {
          url,
          statusCode: response.status,
          error: lastError,
        });

        return {
          success: false,
          statusCode: response.status,
          responseTimeMs,
          attempts: attempt,
          error: lastError,
        };
      }

      // Server error (5xx) - retry
      lastError = `HTTP ${response.status}`;
      logger.warn("Webhook failed (5xx), will retry", {
        url,
        statusCode: response.status,
        attempt,
        maxAttempts: opts.maxAttempts,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = `Timeout after ${opts.timeoutMs}ms`;
      } else {
        lastError = error instanceof Error ? error.message : String(error);
      }

      logger.warn("Webhook request failed, will retry", {
        url,
        error: lastError,
        attempt,
        maxAttempts: opts.maxAttempts,
      });
    }

    // Wait before retry (if not last attempt)
    if (attempt < opts.maxAttempts) {
      const delay = opts.retryDelayMs[attempt - 1] || opts.retryDelayMs[opts.retryDelayMs.length - 1];
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // All attempts failed
  logger.error("Webhook delivery failed after all attempts", {
    url,
    attempts: opts.maxAttempts,
    lastError,
  });

  return {
    success: false,
    statusCode: lastStatusCode,
    responseTimeMs: 0,
    attempts: opts.maxAttempts,
    error: lastError,
  };
}
