import { describe, expect, test } from "bun:test";
import {
	consumeStreamsEvents,
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

describe("consumeStreamsEvents", () => {
	test("paginates in order and advances the cursor", async () => {
		const pages: StreamsEventsEnvelope[] = [
			{ events: [event("1:0", 0), event("1:1", 1)], next_cursor: "1:1", tip: TIP, reorgs: [] },
			{ events: [event("1:2", 2)], next_cursor: "1:2", tip: TIP, reorgs: [] },
		];
		const seen: string[] = [];
		const requestedCursors: Array<string | null | undefined> = [];

		const result = await consumeStreamsEvents({
			fromCursor: null,
			batchSize: 2,
			maxPages: 2,
			fetchEvents: async ({ cursor }) => {
				requestedCursors.push(cursor);
				return pages.shift() as StreamsEventsEnvelope;
			},
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
		const sleeps: number[] = [];

		const result = await consumeStreamsEvents({
			fromCursor: "1:2",
			batchSize: 100,
			emptyBackoffMs: 500,
			maxEmptyPolls: 2,
			fetchEvents: async () => ({
				events: [],
				next_cursor: null,
				tip: TIP,
				reorgs: [],
			}),
			onBatch: () => undefined,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
		});

		expect(result.emptyPolls).toBe(2);
		expect(sleeps).toEqual([500, 500]);
	});

	test("backs off when Streams echoes the input cursor at the clamped tip", async () => {
		const sleeps: number[] = [];

		const result = await consumeStreamsEvents({
			fromCursor: "99:0",
			batchSize: 100,
			emptyBackoffMs: 500,
			maxEmptyPolls: 2,
			fetchEvents: async () => ({
				events: [],
				next_cursor: "99:0",
				tip: TIP,
				reorgs: [],
			}),
			onBatch: () => undefined,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
		});

		expect(result.cursor).toBe("99:0");
		expect(result.emptyPolls).toBe(2);
		expect(sleeps).toEqual([500, 500]);
	});
});
