import { HttpRequestError } from "../errors/http.ts";
import { TimeoutError } from "../errors/transport.ts";
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

/** 5xx and 429 are transient and worth a retry. Every other status is not. */
function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

/** Retry-After above this cap falls back to the normal backoff: a node
 *  asking for minutes should not stall a transport-level retry. */
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

function abortReason(signal: AbortSignal): Error {
	const reason = signal.reason;
	if (reason instanceof Error) return reason;
	return new DOMException(
		typeof reason === "string" ? reason : "The operation was aborted",
		"AbortError",
	);
}

/** Sleep that wakes early (rejecting with the abort reason) when `signal` fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(abortReason(signal));
		const onAbort = () => {
			clearTimeout(id);
			reject(abortReason(signal as AbortSignal));
		};
		const id = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export type FetchWithRetryOptions<T> = {
	/** Caller-side cancellation. Combined with the timeout; never retried. */
	signal?: AbortSignal;
	/**
	 * Consume the response body inside the timeout window. Defaults to
	 * returning the `Response` untouched, in which case the caller reads the
	 * body outside the deadline.
	 */
	read?: (response: Response) => Promise<T>;
};

/**
 * Fetch with linear backoff on network errors, timeouts, 429 and 5xx.
 *
 * One timeout covers each attempt end to end, headers and body: the timer is
 * armed before `fetch` and cleared once the attempt settles (before any
 * retry sleep, and in `finally`), so a body that never arrives rejects with
 * {@link TimeoutError} rather than hanging the caller, and a rejected fetch
 * never leaves a live timer behind.
 * A caller abort (`signal`) rejects at once with the signal's reason and is
 * not retried.
 */
export async function fetchWithRetry<T = Response>(
	url: string,
	options: RequestInit,
	retryCount: number,
	retryDelay: number,
	timeout: number,
	extra: FetchWithRetryOptions<T> = {},
): Promise<T> {
	const { signal } = extra;
	const read =
		extra.read ?? (async (response: Response) => response as unknown as T);
	const method = options.method ?? "GET";
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= retryCount; attempt++) {
		if (signal?.aborted) throw abortReason(signal);

		const controller = new AbortController();
		let timedOut = false;
		const timeoutId = setTimeout(() => {
			timedOut = true;
			controller.abort(new TimeoutError({ method, url, timeout, attempt }));
		}, timeout);
		const onCallerAbort = () =>
			controller.abort(abortReason(signal as AbortSignal));
		signal?.addEventListener("abort", onCallerAbort, { once: true });

		// Rejects the moment the attempt is aborted, whether by the timer or by
		// the caller, so a body read on a stalled stream cannot outlive the
		// deadline even when the runtime does not tie the body to the signal.
		const aborted = new Promise<never>((_, reject) => {
			if (controller.signal.aborted) return reject(controller.signal.reason);
			controller.signal.addEventListener(
				"abort",
				() => reject(controller.signal.reason),
				{ once: true },
			);
		});

		let response: Response;
		try {
			try {
				response = await Promise.race([
					fetch(url, { ...options, signal: controller.signal }),
					aborted,
				]);
			} catch (error) {
				if (signal?.aborted) throw abortReason(signal);
				lastError = timedOut
					? new TimeoutError({ method, url, timeout, attempt })
					: error instanceof Error
						? error
						: new Error(String(error));
				if (attempt < retryCount) {
					clearTimeout(timeoutId);
					await sleep(retryDelay * (attempt + 1), signal);
					continue;
				}
				throw lastError;
			}

			if (response.ok) {
				try {
					return await Promise.race([read(response), aborted]);
				} catch (error) {
					response.body?.cancel().catch(() => {});
					if (signal?.aborted) throw abortReason(signal);
					if (!timedOut) throw error;
					lastError = new TimeoutError({ method, url, timeout, attempt });
					if (attempt < retryCount) {
						clearTimeout(timeoutId);
						await sleep(retryDelay * (attempt + 1), signal);
						continue;
					}
					throw lastError;
				}
			}

			const retryable = isRetryableStatus(response.status);
			if (!retryable || attempt === retryCount) {
				const body = await Promise.race([
					response.text().catch(() => undefined),
					aborted.catch(() => undefined),
				]);
				throw new HttpRequestError(response.status, {
					details: capDetails(body),
					url,
					method,
				});
			}

			lastError = new HttpRequestError(response.status, { url, method });
			// A server-sent Retry-After (429/503) overrides the linear backoff.
			const delay = retryAfterMs(response) ?? retryDelay * (attempt + 1);
			response.body?.cancel().catch(() => {});
			// The attempt is over: a Retry-After longer than `timeout` must not
			// let the attempt timer fire mid-sleep and flag a timeout that never
			// happened.
			clearTimeout(timeoutId);
			await sleep(delay, signal);
		} finally {
			clearTimeout(timeoutId);
			signal?.removeEventListener("abort", onCallerAbort);
		}
	}

	throw lastError ?? new Error("Request failed");
}

/** Decode a 2xx body: JSON when the content type says so, text otherwise. */
export async function readBody(response: Response): Promise<unknown> {
	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		return response.json();
	}
	return response.text();
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

		return fetchWithRetry(
			url,
			init,
			options?.retryCount ?? retryCount,
			retryDelay,
			timeout,
			{ signal: options?.signal, read: readBody },
		);
	};
}
