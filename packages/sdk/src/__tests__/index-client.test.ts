import { afterEach, describe, expect, test } from "bun:test";
import { type FtTransfer, type NftTransfer, SecondLayer } from "../index.ts";

const originalFetch = globalThis.fetch;
const TIP = { block_height: 10, lag_seconds: 1 };

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function ftTransfer(cursor: string, index: number): FtTransfer {
	return {
		cursor,
		block_height: 1,
		tx_id: `0xft${index}`,
		tx_index: index,
		event_index: index,
		event_type: "ft_transfer",
		contract_id: "SP1.token",
		asset_identifier: "SP1.token::token",
		sender: "SP1",
		recipient: "SP2",
		amount: "100",
	};
}

function nftTransfer(cursor: string, index: number): NftTransfer {
	return {
		cursor,
		block_height: 2,
		tx_id: `0xnft${index}`,
		tx_index: index,
		event_index: index,
		event_type: "nft_transfer",
		contract_id: "SP1.collection",
		asset_identifier: "SP1.collection::token",
		sender: "SP1",
		recipient: "SP2",
		value: "0x0100000000000000000000000000000001",
	};
}

describe("SecondLayer Index client", () => {
	test("lists ft transfers with filters and auth", async () => {
		const requests: Request[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			return jsonResponse({
				events: [],
				next_cursor: null,
				tip: TIP,
				reorgs: [],
			});
		}) as typeof fetch;
		const client = new SecondLayer({
			baseUrl: "http://secondlayer.test",
			apiKey: "sk-test",
		});

		const response = await client.index.ftTransfers.list({
			cursor: "1:0",
			limit: 25,
			contractId: "SP1.token",
			sender: "SP1",
			recipient: "SP2",
			fromHeight: 1,
			toHeight: 2,
		});

		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/v1/index/ft-transfers");
		expect(url.searchParams.get("cursor")).toBe("1:0");
		expect(url.searchParams.get("limit")).toBe("25");
		expect(url.searchParams.get("contract_id")).toBe("SP1.token");
		expect(url.searchParams.get("sender")).toBe("SP1");
		expect(url.searchParams.get("recipient")).toBe("SP2");
		expect(url.searchParams.get("from_height")).toBe("1");
		expect(url.searchParams.get("to_height")).toBe("2");
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk-test");
		expect(response.reorgs).toEqual([]);
	});

	test("lists nft transfers with filters and auth", async () => {
		const requests: Request[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			return jsonResponse({
				events: [nftTransfer("2:0", 0)],
				next_cursor: "2:0",
				tip: TIP,
				reorgs: [],
			});
		}) as typeof fetch;
		const client = new SecondLayer({
			baseUrl: "http://secondlayer.test",
			apiKey: "sk-test",
		});

		const response = await client.index.nftTransfers.list({
			fromCursor: "1:9",
			limit: 25,
			contractId: "SP1.collection",
			assetIdentifier: "SP1.collection::token",
			sender: "SP1",
			recipient: "SP2",
			toHeight: 3,
		});

		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/v1/index/nft-transfers");
		expect(url.searchParams.get("from_cursor")).toBe("1:9");
		expect(url.searchParams.get("limit")).toBe("25");
		expect(url.searchParams.get("contract_id")).toBe("SP1.collection");
		expect(url.searchParams.get("asset_identifier")).toBe(
			"SP1.collection::token",
		);
		expect(url.searchParams.get("sender")).toBe("SP1");
		expect(url.searchParams.get("recipient")).toBe("SP2");
		expect(url.searchParams.get("to_height")).toBe("3");
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk-test");
		expect(response.events[0]?.value).toBe(
			"0x0100000000000000000000000000000001",
		);
	});

	test("walks ft transfer history with cursor pagination", async () => {
		const requests: Request[] = [];
		const pages = [
			{
				events: [ftTransfer("1:0", 0), ftTransfer("1:1", 1)],
				next_cursor: "1:1",
				tip: TIP,
				reorgs: [],
			},
			{
				events: [ftTransfer("1:2", 2)],
				next_cursor: "1:2",
				tip: TIP,
				reorgs: [],
			},
		];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			return jsonResponse(pages.shift());
		}) as typeof fetch;
		const client = new SecondLayer({
			baseUrl: "http://secondlayer.test",
			apiKey: "sk-test",
		});
		const seen: string[] = [];

		for await (const event of client.index.ftTransfers.walk({
			batchSize: 2,
			contractId: "SP1.token",
		})) {
			seen.push(event.cursor);
		}

		const firstUrl = new URL(requests[0]?.url ?? "");
		const secondUrl = new URL(requests[1]?.url ?? "");
		expect(seen).toEqual(["1:0", "1:1", "1:2"]);
		expect(firstUrl.pathname).toBe("/v1/index/ft-transfers");
		expect(firstUrl.searchParams.get("from_height")).toBe("0");
		expect(firstUrl.searchParams.get("limit")).toBe("2");
		expect(firstUrl.searchParams.get("contract_id")).toBe("SP1.token");
		expect(firstUrl.searchParams.get("cursor")).toBeNull();
		expect(secondUrl.searchParams.get("cursor")).toBe("1:1");
		expect(secondUrl.searchParams.get("from_height")).toBeNull();
		expect(secondUrl.searchParams.get("contract_id")).toBe("SP1.token");
	});

	test("lists the canonical map with a height window and auth", async () => {
		const requests: Request[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			return jsonResponse({
				canonical: [
					{
						cursor: "9000:0",
						block_height: 9000,
						block_hash: "0x9000",
						parent_hash: "0x8999",
						burn_block_height: 19_000,
						burn_block_hash: "0xb9000",
					},
				],
				next_cursor: "9000:0",
				tip: TIP,
			});
		}) as typeof fetch;
		const client = new SecondLayer({
			baseUrl: "http://secondlayer.test",
			apiKey: "sk-test",
		});

		const response = await client.index.canonical.list({
			fromHeight: 9000,
			toHeight: 9994,
			limit: 50,
		});

		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/v1/index/canonical");
		expect(url.searchParams.get("from_height")).toBe("9000");
		expect(url.searchParams.get("to_height")).toBe("9994");
		expect(url.searchParams.get("limit")).toBe("50");
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk-test");
		expect(response.canonical[0]?.parent_hash).toBe("0x8999");
		// Lean sync primitive: no reorgs[] field.
		expect(response).not.toHaveProperty("reorgs");
	});

	test("walks the canonical map with cursor pagination", async () => {
		const requests: Request[] = [];
		const pages = [
			{
				canonical: [
					{
						cursor: "9000:0",
						block_height: 9000,
						block_hash: "0x9000",
						parent_hash: "0x8999",
						burn_block_height: 19_000,
						burn_block_hash: "0xb9000",
					},
				],
				next_cursor: "9000:0",
				tip: TIP,
			},
			{ canonical: [], next_cursor: null, tip: TIP },
		];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			return jsonResponse(pages.shift());
		}) as typeof fetch;
		const client = new SecondLayer({
			baseUrl: "http://secondlayer.test",
			apiKey: "sk-test",
		});
		const seen: number[] = [];

		for await (const block of client.index.canonical.walk({ batchSize: 1 })) {
			seen.push(block.block_height);
		}

		const firstUrl = new URL(requests[0]?.url ?? "");
		const secondUrl = new URL(requests[1]?.url ?? "");
		expect(seen).toEqual([9000]);
		expect(firstUrl.pathname).toBe("/v1/index/canonical");
		expect(firstUrl.searchParams.get("from_height")).toBe("0");
		expect(secondUrl.searchParams.get("cursor")).toBe("9000:0");
	});

	test("walks nft transfer history until an empty page", async () => {
		const requests: Request[] = [];
		const pages = [
			{
				events: [nftTransfer("2:0", 0)],
				next_cursor: "2:0",
				tip: TIP,
				reorgs: [],
			},
			{ events: [], next_cursor: null, tip: TIP, reorgs: [] },
		];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			return jsonResponse(pages.shift());
		}) as typeof fetch;
		const client = new SecondLayer({
			baseUrl: "http://secondlayer.test",
			apiKey: "sk-test",
		});
		const seen: string[] = [];

		for await (const event of client.index.nftTransfers.walk({
			fromCursor: "1:9",
			batchSize: 1,
			assetIdentifier: "SP1.collection::token",
		})) {
			seen.push(event.cursor);
		}

		const firstUrl = new URL(requests[0]?.url ?? "");
		const secondUrl = new URL(requests[1]?.url ?? "");
		expect(seen).toEqual(["2:0"]);
		expect(firstUrl.pathname).toBe("/v1/index/nft-transfers");
		expect(firstUrl.searchParams.get("from_cursor")).toBe("1:9");
		expect(firstUrl.searchParams.get("from_height")).toBeNull();
		expect(firstUrl.searchParams.get("asset_identifier")).toBe(
			"SP1.collection::token",
		);
		expect(secondUrl.searchParams.get("cursor")).toBe("2:0");
		expect(secondUrl.searchParams.get("from_cursor")).toBeNull();
		expect(secondUrl.searchParams.get("asset_identifier")).toBe(
			"SP1.collection::token",
		);
	});
});
