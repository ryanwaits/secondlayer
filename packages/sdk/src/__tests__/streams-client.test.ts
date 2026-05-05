import { describe, expect, test } from "bun:test";
import {
	AuthError,
	createStreamsClient,
	RateLimitError,
	StreamsServerError,
	ValidationError,
	type StreamsEvent,
} from "../index.ts";

const TIP = {
	block_height: 10,
	index_block_hash: "0x01",
	burn_block_height: 20,
	lag_seconds: 0,
};

function jsonResponse(
	body: unknown,
	status = 200,
	headers?: Record<string, string>,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function event(cursor: string, index: number): StreamsEvent {
	return {
		cursor,
		block_height: 1,
		index_block_hash: TIP.index_block_hash,
		burn_block_height: TIP.burn_block_height,
		tx_id: `0x${index}`,
		tx_index: index,
		event_index: index,
		event_type: "ft_transfer",
		contract_id: "SP1.token",
		payload: {
			asset_identifier: "SP1.token::token",
			sender: "SP1",
			recipient: "SP2",
			amount: "1",
		},
		ts: "2026-05-02T21:43:00.000Z",
	};
}

describe("createStreamsClient", () => {
	test("lists events with typed query params and auth", async () => {
		const requests: Request[] = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				requests.push(request);
				return jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [],
				});
			},
		});

		await client.events.list({
			cursor: "1:0",
			fromHeight: 1,
			toHeight: 2,
			types: ["ft_transfer"],
			contractId: "SP1.token",
			limit: 10,
		});

		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/v1/streams/events");
		expect(url.searchParams.get("cursor")).toBe("1:0");
		expect(url.searchParams.get("from_height")).toBe("1");
		expect(url.searchParams.get("to_height")).toBe("2");
		expect(url.searchParams.get("types")).toBe("ft_transfer");
		expect(url.searchParams.get("contract_id")).toBe("SP1.token");
		expect(url.searchParams.get("limit")).toBe("10");
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk-test");
	});

	test("builds convenience endpoint URLs with auth", async () => {
		const requests: Request[] = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				requests.push(request);
				if (request.url.includes("/canonical/100")) {
					return jsonResponse({
						block_height: 100,
						index_block_hash: "0x01",
						burn_block_height: 200,
						burn_block_hash: null,
						is_canonical: true,
					});
				}
				if (request.url.includes("/reorgs")) {
					return jsonResponse({ reorgs: [], next_since: null });
				}
				return jsonResponse({ events: [], tip: TIP, reorgs: [] });
			},
		});

		await client.canonical(100);
		await client.events.byTxId("0xtx");
		await client.blocks.events("0xblock");
		await client.reorgs.list({ since: "2026-05-03T00:00:00.000Z", limit: 5 });

		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			"/v1/streams/canonical/100",
			"/v1/streams/events/0xtx",
			"/v1/streams/blocks/0xblock/events",
			"/v1/streams/reorgs",
		]);
		expect(new URL(requests[3]?.url ?? "").searchParams.get("limit")).toBe("5");
		expect(
			requests.every(
				(request) => request.headers.get("Authorization") === "Bearer sk-test",
			),
		).toBe(true);
	});

	test("maps 401 to AuthError", async () => {
		const client = createStreamsClient({
			apiKey: "bad",
			fetchImpl: async () => jsonResponse({ error: "API key invalid" }, 401),
		});

		await expect(client.events.list()).rejects.toBeInstanceOf(AuthError);
	});

	test("maps 429 to RateLimitError with retry-after", async () => {
		const client = createStreamsClient({
			apiKey: "limited",
			fetchImpl: async () =>
				jsonResponse({ error: "too many" }, 429, { "Retry-After": "3" }),
		});

		try {
			await client.events.list();
			throw new Error("expected rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(RateLimitError);
			expect((error as RateLimitError).retryAfter).toBe("3");
		}
	});

	test("maps 400 to ValidationError", async () => {
		const client = createStreamsClient({
			apiKey: "bad-request",
			fetchImpl: async () => jsonResponse({ error: "bad cursor" }, 400),
		});

		await expect(client.events.list()).rejects.toBeInstanceOf(ValidationError);
	});

	test("maps 500 to StreamsServerError", async () => {
		const client = createStreamsClient({
			apiKey: "server-error",
			fetchImpl: async () => jsonResponse({ error: "down" }, 500),
		});

		await expect(client.events.list()).rejects.toBeInstanceOf(
			StreamsServerError,
		);
	});

	test("stream yields paginated events in order", async () => {
		const pages = [
			{
				events: [event("1:0", 0), event("1:1", 1)],
				next_cursor: "1:1",
				tip: TIP,
				reorgs: [],
			},
			{ events: [event("1:2", 2)], next_cursor: "1:2", tip: TIP, reorgs: [] },
		];
		const requestedCursors: Array<string | null> = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async (input) => {
				const url = new URL(input.toString());
				requestedCursors.push(url.searchParams.get("cursor"));
				return jsonResponse(pages.shift());
			},
		});
		const seen: string[] = [];

		for await (const item of client.events.stream({ batchSize: 2 })) {
			seen.push(item.cursor);
			if (seen.length === 3) break;
		}

		expect(seen).toEqual(["1:0", "1:1", "1:2"]);
		expect(requestedCursors).toEqual([null, "1:1"]);
	});

	test("stream terminates cleanly when aborted during empty-page backoff", async () => {
		const controller = new AbortController();
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () => {
				controller.abort();
				return jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [],
				});
			},
		});
		const seen: StreamsEvent[] = [];

		for await (const item of client.events.stream({
			batchSize: 10,
			signal: controller.signal,
		})) {
			seen.push(item);
		}

		expect(seen).toEqual([]);
	});

	test("stream stops at maxPages", async () => {
		const pages = [
			{ events: [event("1:0", 0)], next_cursor: "1:0", tip: TIP, reorgs: [] },
			{ events: [event("1:1", 1)], next_cursor: "1:1", tip: TIP, reorgs: [] },
		];
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () => jsonResponse(pages.shift()),
		});
		const seen: string[] = [];

		for await (const item of client.events.stream({
			batchSize: 1,
			maxPages: 1,
		})) {
			seen.push(item.cursor);
		}

		expect(seen).toEqual(["1:0"]);
		expect(pages).toHaveLength(1);
	});

	test("stream stops at maxEmptyPolls", async () => {
		let requests = 0;
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () => {
				requests++;
				return jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [],
				});
			},
		});
		const seen: StreamsEvent[] = [];

		for await (const item of client.events.stream({
			batchSize: 10,
			emptyBackoffMs: 0,
			maxEmptyPolls: 2,
		})) {
			seen.push(item);
		}

		expect(seen).toEqual([]);
		expect(requests).toBe(2);
	});
});
