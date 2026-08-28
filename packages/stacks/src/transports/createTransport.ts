import { HttpRequestError } from "../errors/http.ts";
import type {
	RequestFn,
	RequestOptions,
	Transport,
	TransportConfig,
} from "./types.ts";

/** Bind a request function into a transport. The exposed `config` never
 *  carries `apiKey`: the key lives in the request closure, so logging a
 *  client or inspecting `client.transport.config` does not print it. */
export function createTransport(
	type: string,
	config: TransportConfig & { request: RequestFn },
): Transport {
	const { request, apiKey: _apiKey, ...exposed } = config;
	return {
		type,
		request,
		config: exposed,
	};
}

/** Longest response body kept on `HttpRequestError.details`. The body is
 *  untrusted and lands in `error.message`, so a runaway HTML page or a
 *  hostile reply must not become a multi-megabyte log line. */
export const MAX_ERROR_DETAILS_BYTES = 4096;

function capDetails(body: string | undefined): string | undefined {
	if (body === undefined) return undefined;
	const bytes = new TextEncoder().encode(body);
	if (bytes.length <= MAX_ERROR_DETAILS_BYTES) return body;
	const head = new TextDecoder().decode(
		bytes.subarray(0, MAX_ERROR_DETAILS_BYTES),
	);
	return `${head}... [truncated ${bytes.length - MAX_ERROR_DETAILS_BYTES} bytes]`;
}

/** 5xx and 429 are transient — worth a retry. Every other status is not. */
function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

/** Retry-After above this cap falls back to the normal backoff — a node
 *  asking for minutes shouldn't stall a transport-level retry. */
const MAX_RETRY_AFTER_MS = 60_000;

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into a delay,
 *  or undefined when absent/unparseable/over the cap. */
function retryAfterMs(response: Response): number | undefined {
	const value = response.headers.get("Retry-After");
	if (!value) return undefined;
	const seconds = Number(value);
	const ms = Number.isFinite(seconds)
		? seconds * 1000
		: Date.parse(value) - Date.now();
	if (!Number.isFinite(ms) || ms < 0 || ms > MAX_RETRY_AFTER_MS)
		return undefined;
	return ms;
}

export async function fetchWithRetry(
	url: string,
	options: RequestInit,
	retryCount: number,
	retryDelay: number,
	timeout: number,
): Promise<Response> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= retryCount; attempt++) {
		let response: Response;
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeout);

			response = await fetch(url, {
				...options,
				signal: controller.signal,
			});

			clearTimeout(timeoutId);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < retryCount) {
				await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
				continue;
			}
			throw lastError;
		}

		if (response.ok) {
			return response;
		}

		const retryable = isRetryableStatus(response.status);
		if (!retryable || attempt === retryCount) {
			throw new HttpRequestError(response.status, {
				details: capDetails(await response.text().catch(() => undefined)),
			});
		}

		lastError = new HttpRequestError(response.status);
		// A server-sent Retry-After (429/503) overrides the linear backoff.
		const delay = retryAfterMs(response) ?? retryDelay * (attempt + 1);
		await new Promise((r) => setTimeout(r, delay));
	}

	throw lastError ?? new Error("Request failed");
}

export function buildRequestFn(
	baseUrl: string,
	config: TransportConfig,
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
			timeout,
		);

		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			return response.json();
		}
		return response.text();
	};
}
