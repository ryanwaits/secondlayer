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
