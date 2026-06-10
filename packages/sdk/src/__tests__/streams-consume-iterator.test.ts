import { describe, expect, test } from "bun:test";
import {
	type StreamsBatch,
	type StreamsEvent,
	type StreamsEventsEnvelope,
	createStreamsClient,
} from "../index.ts";

const TIP = {
	block_height: 10,
	block_hash: "0x01",
	burn_block_height: 20,
	lag_seconds: 0,
};

function event(cursor: string, index: number): StreamsEvent {
	return {
		cursor,
		block_height: 1,
		block_hash: TIP.block_hash,
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
		ts: "2026-06-09T00:00:00.000Z",
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("client.consume (async-iterator batches)", () => {
	test("yields one batch per page mapping the envelope, advancing the cursor", async () => {
		const pages: StreamsEventsEnvelope[] = [
			{
				events: [event("1:0", 0), event("1:1", 1)],
				next_cursor: "1:1",
				tip: TIP,
				reorgs: [],
			},
			{ events: [event("2:0", 2)], next_cursor: "2:0", tip: TIP, reorgs: [] },
		];
		const requestedCursors: Array<string | null> = [];
		const abort = new AbortController();
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async (input) => {
				const url = new URL(input.toString());
				requestedCursors.push(url.searchParams.get("cursor"));
				const page = pages.shift();
				if (!page) abort.abort();
				return jsonResponse(
					page ?? { events: [], next_cursor: "2:0", tip: TIP, reorgs: [] },
				);
			},
		});

		const batches: StreamsBatch[] = [];
		for await (const batch of client.consume({
			cursor: null,
			batchSize: 2,
			intervalMs: 1,
			signal: abort.signal,
		})) {
			batches.push(batch);
		}

		expect(batches.length).toBe(2);
		expect(batches[0]?.events.map((e) => e.cursor)).toEqual(["1:0", "1:1"]);
		expect(batches[0]?.cursor).toBe("1:1");
		expect(batches[0]?.tip).toEqual(TIP);
		expect(batches[0]?.reorgs).toEqual([]);
		expect(batches[1]?.cursor).toBe("2:0");
		// Second page was requested strictly after the first checkpoint.
		expect(requestedCursors[0]).toBeNull();
		expect(requestedCursors[1]).toBe("1:1");
	});

	test("skips empty pages and re-polls until aborted", async () => {
		let calls = 0;
		const abort = new AbortController();
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () => {
				calls++;
				if (calls >= 3) abort.abort();
				return jsonResponse({
					events: [],
					next_cursor: "5:0",
					tip: TIP,
					reorgs: [],
				});
			},
		});

		const batches: StreamsBatch[] = [];
		for await (const batch of client.consume({
			cursor: "5:0",
			intervalMs: 1,
			signal: abort.signal,
		})) {
			batches.push(batch);
		}

		expect(batches.length).toBe(0);
		expect(calls).toBeGreaterThanOrEqual(2);
	});

	test("surfaces reorgs on the batch even when the page has no events", async () => {
		const reorg = {
			detected_at: "2026-06-09T00:00:00.000Z",
			fork_point_height: 5,
			orphaned_range: { from: "6:0", to: "8:0" },
			new_canonical_tip: "8:0",
		};
		let calls = 0;
		const abort = new AbortController();
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () => {
				calls++;
				if (calls >= 2) abort.abort();
				return jsonResponse({
					events: [],
					next_cursor: "8:0",
					tip: TIP,
					reorgs: calls === 1 ? [reorg] : [],
				});
			},
		});

		const batches: StreamsBatch[] = [];
		for await (const batch of client.consume({
			cursor: "8:0",
			intervalMs: 1,
			signal: abort.signal,
		})) {
			batches.push(batch);
		}

		expect(batches.length).toBe(1);
		expect(batches[0]?.reorgs).toEqual([reorg]);
		expect(batches[0]?.events).toEqual([]);
	});

	test("passes filters through to the events query", async () => {
		const abort = new AbortController();
		let seenUrl = "";
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async (input) => {
				seenUrl = input.toString();
				abort.abort();
				return jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [],
				});
			},
		});

		for await (const _ of client.consume({
			types: ["ft_transfer"],
			contractId: "SP1.token",
			batchSize: 7,
			intervalMs: 1,
			signal: abort.signal,
		})) {
			// drained by abort
		}

		const url = new URL(seenUrl);
		expect(url.pathname).toBe("/v1/streams/events");
		expect(url.searchParams.get("types")).toBe("ft_transfer");
		expect(url.searchParams.get("contract_id")).toBe("SP1.token");
		expect(url.searchParams.get("limit")).toBe("7");
	});
});
