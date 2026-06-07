import { afterEach, describe, expect, mock, test } from "bun:test";
import { Contracts } from "./client.ts";

const BASE_URL = "http://localhost:3800";
const originalFetch = globalThis.fetch;

function mockResponse(status: number, body: unknown) {
	globalThis.fetch = mock((input: string | URL | Request) => {
		const url = typeof input === "string" ? input : input.toString();
		(mockResponse as unknown as { lastUrl?: string }).lastUrl = url;
		return Promise.resolve({
			ok: status >= 200 && status < 300,
			status,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => Promise.resolve(body),
			text: () => Promise.resolve(JSON.stringify(body)),
		} as Response);
	}) as unknown as typeof fetch;
}

describe("Contracts.get", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("fetches a contract with ABI when includeAbi is set", async () => {
		mockResponse(200, {
			contract: { contract_id: "SP1.token", abi_status: "ok", abi: {} },
		});
		const c = await new Contracts({ baseUrl: BASE_URL }).get("SP1.token", {
			includeAbi: true,
		});
		expect((mockResponse as unknown as { lastUrl: string }).lastUrl).toContain(
			"/v1/contracts/SP1.token?include=abi",
		);
		expect(c?.contract_id).toBe("SP1.token");
	});

	test("resolves null on 404", async () => {
		mockResponse(404, { error: "not found", code: "CONTRACT_NOT_FOUND" });
		const c = await new Contracts({ baseUrl: BASE_URL }).get("SP1.missing");
		expect(c).toBeNull();
	});
});
