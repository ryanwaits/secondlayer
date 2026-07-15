import { afterEach, describe, expect, it, mock } from "bun:test";
import { HttpRequestError } from "../../errors/http.ts";
import { fetchWithRetry } from "../createTransport.ts";

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

describe("fetchWithRetry", () => {
	it("returns the response on 2xx", async () => {
		setFetchMock(async () => jsonResponse(200, { ok: true }));
		const res = await fetchWithRetry("http://x", {}, 0, 1, 1000);
		expect(res.status).toBe(200);
	});

	it("throws HttpRequestError on 404 without retrying", async () => {
		const fetchMock = setFetchMock(async () =>
			jsonResponse(404, { error: "nope" }),
		);
		await expect(fetchWithRetry("http://x", {}, 3, 1, 1000)).rejects.toThrow(
			HttpRequestError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("carries the status and body text on HttpRequestError", async () => {
		setFetchMock(async () => jsonResponse(400, { error: "BadNonce" }));
		try {
			await fetchWithRetry("http://x", {}, 0, 1, 1000);
			throw new Error("expected rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(HttpRequestError);
			const httpError = error as HttpRequestError;
			expect(httpError.status).toBe(400);
			expect(httpError.details).toContain("BadNonce");
		}
	});

	it("retries on 429 then succeeds", async () => {
		let calls = 0;
		setFetchMock(async () => {
			calls += 1;
			return calls < 3
				? jsonResponse(429, {})
				: jsonResponse(200, { ok: true });
		});
		const res = await fetchWithRetry("http://x", {}, 3, 1, 1000);
		expect(res.status).toBe(200);
		expect(calls).toBe(3);
	});

	it("retries on 5xx then throws after exhausting retries", async () => {
		const fetchMock = setFetchMock(async () => jsonResponse(503, {}));
		await expect(fetchWithRetry("http://x", {}, 2, 1, 1000)).rejects.toThrow(
			HttpRequestError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("does not retry on non-retryable 4xx", async () => {
		const fetchMock = setFetchMock(async () => jsonResponse(401, {}));
		await expect(fetchWithRetry("http://x", {}, 3, 1, 1000)).rejects.toThrow(
			HttpRequestError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("retries on network errors then throws", async () => {
		const fetchMock = setFetchMock(async () => {
			throw new Error("network down");
		});
		await expect(fetchWithRetry("http://x", {}, 2, 1, 1000)).rejects.toThrow(
			"network down",
		);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});
