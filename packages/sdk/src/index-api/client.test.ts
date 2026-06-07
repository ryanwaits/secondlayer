import { afterEach, describe, expect, mock, test } from "bun:test";
import { Index } from "./client.ts";

const BASE_URL = "http://localhost:3800";
const originalFetch = globalThis.fetch;

function recorder(body: unknown = {}) {
	const urls: string[] = [];
	globalThis.fetch = mock((input: string | URL | Request) => {
		urls.push(typeof input === "string" ? input : input.toString());
		return Promise.resolve({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => Promise.resolve(body),
			text: () => Promise.resolve(JSON.stringify(body)),
		} as Response);
	}) as unknown as typeof fetch;
	return urls;
}

describe("Index trait filter + discover", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("events.list forwards trait as ?trait=", async () => {
		const urls = recorder({
			events: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).events.list({
			eventType: "ft_transfer",
			trait: "sip-010",
		});
		expect(urls[0]).toContain("/v1/index/events");
		expect(urls[0]).toContain("event_type=ft_transfer");
		expect(urls[0]).toContain("trait=sip-010");
	});

	test("contractCalls.list forwards trait", async () => {
		const urls = recorder({
			contract_calls: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).contractCalls.list({
			trait: "sip-010",
		});
		expect(urls[0]).toContain("/v1/index/contract-calls");
		expect(urls[0]).toContain("trait=sip-010");
	});

	test("discover hits GET /v1/index", async () => {
		const urls = recorder({ event_type_filters: { ft_transfer: {} } });
		const doc = await new Index({ baseUrl: BASE_URL }).discover();
		expect(urls[0]).toMatch(/\/v1\/index($|\?)/);
		expect(doc.event_type_filters).toBeDefined();
	});

	test("transactions.getProof hits the /proof path", async () => {
		const urls = recorder({
			raw_tx: "00",
			raw_header: "00",
			tx_merkle_path: [],
		});
		const proof = await new Index({ baseUrl: BASE_URL }).transactions.getProof(
			"0xabc",
		);
		expect(urls[0]).toContain("/v1/index/transactions/0xabc/proof");
		expect(proof).not.toBeNull();
	});

	test("transactions.getProof resolves null on 404", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: false,
				status: 404,
				headers: new Headers(),
				json: () => Promise.resolve({ error: "not found" }),
				text: () => Promise.resolve('{"error":"not found"}'),
			} as Response),
		) as unknown as typeof fetch;
		const proof = await new Index({ baseUrl: BASE_URL }).transactions.getProof(
			"0xmissing",
		);
		expect(proof).toBeNull();
	});
});
