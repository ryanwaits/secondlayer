import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { HttpRequestError } from "../../errors/http.ts";
import { TimeoutError } from "../../errors/transport.ts";
import { fetchWithRetry } from "../createTransport.ts";
import { http } from "../http.ts";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function setFetchMock(impl: (...args: unknown[]) => Promise<unknown>) {
	const fetchMock = mock(impl);
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

/** A 200 response whose body never delivers a single byte. */
function stalledResponse(): Response {
	const body = new ReadableStream<Uint8Array>({
		start() {
			// Never enqueue, never close: the read hangs until cancelled.
		},
	});
	return new Response(body, {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("transport timeout covers the body read", () => {
	it("rejects a stalled body with TimeoutError carrying method, url, timeout and attempt", async () => {
		setFetchMock(async () => stalledResponse());
		const transport = http("http://node.test", {
			retryCount: 0,
			timeout: 20,
		})({});

		let caught: unknown;
		try {
			await transport.request("/v2/info");
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(TimeoutError);
		const timeoutError = caught as TimeoutError;
		expect(timeoutError.method).toBe("GET");
		expect(timeoutError.url).toBe("http://node.test/v2/info");
		expect(timeoutError.timeout).toBe(20);
		expect(timeoutError.attempt).toBe(0);
	});

	it("clears the per-attempt timer when fetch rejects", async () => {
		setFetchMock(async () => {
			throw new TypeError("connection refused");
		});
		const armed: unknown[] = [];
		const cleared: unknown[] = [];
		const setSpy = spyOn(globalThis, "setTimeout").mockImplementation(((
			...args: Parameters<typeof setTimeout>
		) => {
			const id = originalSetTimeout(...args);
			// Attempt timers are the ones armed with the request timeout; the
			// retry sleep between attempts fires on its own.
			if (args[1] === 10_000) armed.push(id);
			return id;
		}) as typeof setTimeout);
		const clearSpy = spyOn(globalThis, "clearTimeout").mockImplementation(((
			id: Parameters<typeof clearTimeout>[0],
		) => {
			cleared.push(id);
			return originalClearTimeout(id);
		}) as typeof clearTimeout);
		try {
			await expect(
				fetchWithRetry("http://node.test/v2/info", {}, 1, 1, 10_000),
			).rejects.toThrow("connection refused");
			// Both attempt timers were cleared by id; neither can fire later.
			expect(armed.length).toBe(2);
			for (const id of armed) expect(cleared).toContain(id);
		} finally {
			setSpy.mockRestore();
			clearSpy.mockRestore();
		}
	});

	it("stops the attempt timer before a Retry-After sleep longer than the timeout", async () => {
		let calls = 0;
		setFetchMock(async () => {
			calls++;
			if (calls === 1) {
				return new Response("busy", {
					status: 503,
					headers: { "Retry-After": "0.02" },
				});
			}
			return new Response("{}", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});
		const cleared: unknown[] = [];
		const clearSpy = spyOn(globalThis, "clearTimeout").mockImplementation(((
			id: Parameters<typeof clearTimeout>[0],
		) => {
			cleared.push(id);
			return originalClearTimeout(id);
		}) as typeof clearTimeout);
		let firedAttemptTimer = false;
		const setSpy = spyOn(globalThis, "setTimeout").mockImplementation(((
			fn: (...a: unknown[]) => void,
			ms?: number,
			...rest: unknown[]
		) => {
			// The attempt timer is the one armed with the request timeout.
			const wrapped =
				ms === 5
					? (...a: unknown[]) => {
							firedAttemptTimer = true;
							fn(...a);
						}
					: fn;
			return originalSetTimeout(wrapped, ms, ...rest);
		}) as typeof setTimeout);
		try {
			const result = await fetchWithRetry(
				"http://node.test/v2/info",
				{},
				1,
				1,
				5,
				{ read: (r) => r.json() },
			);
			expect(result).toEqual({});
			// Retry-After (20ms) outlasts the attempt timeout (5ms): a timer
			// left running through the sleep would have fired by now.
			expect(firedAttemptTimer).toBe(false);
			expect(cleared.length).toBeGreaterThanOrEqual(2);
		} finally {
			setSpy.mockRestore();
			clearSpy.mockRestore();
		}
	});

	it("retries a timed-out attempt and reports the attempt index on the final TimeoutError", async () => {
		const fetchMock = setFetchMock(async () => stalledResponse());
		let caught: unknown;
		try {
			await fetchWithRetry("http://node.test/v2/info", {}, 1, 1, 10, {
				read: (response) => response.json(),
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(TimeoutError);
		expect((caught as TimeoutError).attempt).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe("caller abort signal", () => {
	it("rejects with the signal's reason and never retries", async () => {
		const fetchMock = setFetchMock(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					(init as RequestInit).signal?.addEventListener("abort", () =>
						reject(new DOMException("Aborted", "AbortError")),
					);
				}),
		);
		const controller = new AbortController();
		const transport = http("http://node.test", {
			retryCount: 3,
			timeout: 10_000,
		})({});
		const pending = transport.request("/v2/info", {
			signal: controller.signal,
		});
		controller.abort(new Error("caller gave up"));
		await expect(pending).rejects.toThrow("caller gave up");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("an already-aborted signal short-circuits before any fetch", async () => {
		const fetchMock = setFetchMock(async () => new Response("{}"));
		const controller = new AbortController();
		controller.abort();
		await expect(
			fetchWithRetry("http://node.test/v2/info", {}, 3, 1, 1000, {
				signal: controller.signal,
			}),
		).rejects.toThrow();
		expect(fetchMock).toHaveBeenCalledTimes(0);
	});

	it("abort during a stalled body read is not reported as a timeout", async () => {
		setFetchMock(async () => stalledResponse());
		const controller = new AbortController();
		const pending = fetchWithRetry(
			"http://node.test/v2/info",
			{},
			2,
			1,
			10_000,
			{ signal: controller.signal, read: (r) => r.json() },
		);
		setTimeout(() => controller.abort(new Error("stop reading")), 5);
		await expect(pending).rejects.toThrow("stop reading");
	});
});

describe("per-request retry override", () => {
	it("retryCount: 0 on the request disables the transport's retries", async () => {
		const fetchMock = setFetchMock(
			async () => new Response("{}", { status: 503 }),
		);
		const transport = http("http://node.test", { retryCount: 3 })({});
		await expect(
			transport.request("/v2/transactions", { method: "POST", retryCount: 0 }),
		).rejects.toThrow(HttpRequestError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("HttpRequestError names the request", () => {
	it("carries url and method and puts them in the message", async () => {
		setFetchMock(async () => new Response("nope", { status: 404 }));
		const transport = http("http://node.test", { retryCount: 0 })({});
		let caught: unknown;
		try {
			await transport.request("/v2/accounts/SP1", { method: "GET" });
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(HttpRequestError);
		const httpError = caught as HttpRequestError;
		expect(httpError.url).toBe("http://node.test/v2/accounts/SP1");
		expect(httpError.method).toBe("GET");
		expect(httpError.message).toContain("GET http://node.test/v2/accounts/SP1");
		expect(httpError.details).toBe("nope");
	});
});
