import type { TransportConfig, RequestFn, Transport, RequestOptions } from "./types.ts";

export function createTransport(
  type: string,
  config: TransportConfig & { request: RequestFn }
): Transport {
  return {
    type,
    request: config.request,
    config,
  };
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryCount: number,
  retryDelay: number,
  timeout: number
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok || response.status < 500) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < retryCount) {
      await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
    }
  }

  throw lastError ?? new Error("Request failed");
}

export function buildRequestFn(
  baseUrl: string,
  config: TransportConfig
): RequestFn {
  const {
    timeout = 30_000,
    retryCount = 3,
    retryDelay = 150,
    fetchOptions = {},
    apiKey,
  } = config;

  return async (path: string, options?: RequestOptions) => {
    const url = `${baseUrl.replace(/\/$/, "")}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(fetchOptions.headers as Record<string, string>),
      ...options?.headers,
    };

    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    const init: RequestInit = {
      ...fetchOptions,
      method: options?.method ?? "GET",
      headers,
    };

    if (options?.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    const response = await fetchWithRetry(
      url,
      init,
      retryCount,
      retryDelay,
      timeout
    );

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return response.text();
  };
}
