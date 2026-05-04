import { describe, expect, test } from "bun:test";
import {
	createStreamsClient,
	type StreamsEvent,
	type StreamsEventsEnvelope,
} from "../index.ts";

const TIP = {
	block_height: 10,
	index_block_hash: "0x01",
	burn_block_height: 20,
	lag_seconds: 0,
};

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

describe("client.events.consume", () => {
	test("paginates in order and advances the cursor", async () => {
		const pages: StreamsEventsEnvelope[] = [
			{ events: [event("1:0", 0), event("1:1", 1)], next_cursor: "1:1", tip: TIP, reorgs: [] },
			{ events: [event("1:2", 2)], next_cursor: "1:2", tip: TIP, reorgs: [] },
		];
		const seen: string[] = [];
		const requestedCursors: Array<string | null | undefined> = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async (input) => {
				const url = new URL(input.toString());
				requestedCursors.push(url.searchParams.get("cursor"));
				return jsonResponse(pages.shift());
			},
		});

		const result = await client.events.consume({
			fromCursor: null,
			batchSize: 2,
			maxPages: 2,
			onBatch: (events, envelope) => {
				seen.push(...events.map((e) => e.cursor));
				return envelope.next_cursor;
			},
		});

		expect(seen).toEqual(["1:0", "1:1", "1:2"]);
		expect(requestedCursors).toEqual([null, "1:1"]);
		expect(result.cursor).toBe("1:2");
	});

	test("backs off when Streams is caught up", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [],
				}),
		});

		const result = await client.events.consume({
			fromCursor: "1:2",
			batchSize: 100,
			emptyBackoffMs: 0,
			maxEmptyPolls: 2,
			onBatch: () => undefined,
		});

		expect(result.emptyPolls).toBe(2);
	});

	test("backs off when Streams echoes the input cursor at the clamped tip", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				jsonResponse({
					events: [],
					next_cursor: "99:0",
					tip: TIP,
					reorgs: [],
				}),
		});

		const result = await client.events.consume({
			fromCursor: "99:0",
			batchSize: 100,
			emptyBackoffMs: 0,
			maxEmptyPolls: 2,
			onBatch: () => undefined,
		});

		expect(result.cursor).toBe("99:0");
		expect(result.emptyPolls).toBe(2);
	});

	test("bounded mode exits on the first empty page", async () => {
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

		const result = await client.events.consume({
			mode: "bounded",
			fromCursor: "1:2",
			batchSize: 100,
			onBatch: () => undefined,
		});

		expect(requests).toBe(1);
		expect(result.emptyPolls).toBe(1);
	});
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
