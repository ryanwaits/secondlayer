import { afterEach, describe, expect, test } from "bun:test";
import { ARCHIVE_STATUS_URL, fetchArchiveStatus } from "./archive-status";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("fetchArchiveStatus", () => {
	test("GETs status.json with a 60s revalidate", async () => {
		const body = {
			schema_version: 1,
			state: "lagging",
			source: { decoder_head: 8_975_100 },
		};
		let url = "";
		let init: RequestInit | undefined;
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			nextInit?: RequestInit,
		) => {
			url = String(input);
			init = nextInit;
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch;

		const status = await fetchArchiveStatus();
		expect(url).toBe(ARCHIVE_STATUS_URL);
		expect(status?.source.decoder_head).toBe(8_975_100);
		expect(
			(init as RequestInit & { next?: { revalidate?: number } }).next
				?.revalidate,
		).toBe(60);
	});

	test("returns null when the archive is unreachable", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network");
		}) as unknown as typeof fetch;
		expect(await fetchArchiveStatus()).toBe(null);
	});

	test("returns null on a non-OK response", async () => {
		globalThis.fetch = (async () =>
			new Response("nope", { status: 503 })) as unknown as typeof fetch;
		expect(await fetchArchiveStatus()).toBe(null);
	});
});
