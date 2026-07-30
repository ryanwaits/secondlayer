import { afterEach, describe, expect, it, mock } from "bun:test";
import { HttpRequestError } from "../../errors/http.ts";
import { http } from "../http.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function setFetchMock(impl: (...args: unknown[]) => Promise<unknown>) {
	const fetchMock = mock(impl);
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

describe("http() transport config overrides", () => {
	it("honors retryCount: 0 — no retry on a retryable 5xx", async () => {
		const fetchMock = setFetchMock(async () => jsonResponse(503, {}));

		const transport = http("http://x", { retryCount: 0 })({});
		await expect(transport.request("/v2/info")).rejects.toThrow(
			HttpRequestError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("defaults to retryCount: 3 when not overridden", async () => {
		const fetchMock = setFetchMock(async () => jsonResponse(503, {}));

		const transport = http("http://x")({});
		await expect(transport.request("/v2/info")).rejects.toThrow(
			HttpRequestError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
	});

	it("honors a custom timeout by aborting before the response resolves", async () => {
		setFetchMock(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					const signal = (init as RequestInit)?.signal;
					signal?.addEventListener("abort", () => {
						reject(new DOMException("Aborted", "AbortError"));
					});
				}),
		);

		const transport = http("http://x", { retryCount: 0, timeout: 10 })({});
		await expect(transport.request("/v2/info")).rejects.toThrow();
	});
});

describe("Retry-After honoring", () => {
	it("waits the server-sent Retry-After instead of the linear backoff", async () => {
		let calls = 0;
		const started = Date.now();
		setFetchMock(async () => {
			calls++;
			if (calls === 1) {
				return new Response("{}", {
					status: 429,
					headers: { "Retry-After": "0" }, // 0s: honored, effectively no wait
				});
			}
			return jsonResponse(200, { ok: true });
		});

		// retryDelay of 5s would blow the test budget if the header were ignored.
		const transport = http("http://x", { retryCount: 1, retryDelay: 5000 })({});
		await expect(transport.request("/v2/info")).resolves.toEqual({ ok: true });
		expect(calls).toBe(2);
		expect(Date.now() - started).toBeLessThan(2000);
	});

	it("falls back to the backoff when Retry-After exceeds the cap", async () => {
		let calls = 0;
		setFetchMock(async () => {
			calls++;
			if (calls === 1) {
				return new Response("{}", {
					status: 429,
					headers: { "Retry-After": "3600" }, // over the 60s cap → ignored
				});
			}
			return jsonResponse(200, { ok: true });
		});

		const transport = http("http://x", { retryCount: 1, retryDelay: 1 })({});
		await expect(transport.request("/v2/info")).resolves.toEqual({ ok: true });
		expect(calls).toBe(2);
	});
});
