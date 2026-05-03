import { describe, expect, test } from "bun:test";
import {
	getStreamsEventsResponse,
	type StreamsEventsReader,
} from "./events.ts";
import type { StreamsTip } from "./tip.ts";

const TIP: StreamsTip = {
	block_height: 10,
	index_block_hash:
		"0x0000000000000000000000000000000000000000000000000000000000000001",
	burn_block_height: 20,
	lag_seconds: 0,
};

function params(query: string) {
	return new URL(`http://localhost/v1/streams/events${query}`).searchParams;
}

describe("Streams events route helpers", () => {
	test("types filter returns only requested types", async () => {
		const readEvents: StreamsEventsReader = async ({ types }) => ({
			events: (types ?? []).map((eventType, i) => ({
				cursor: `1:${i}`,
				block_height: 1,
				index_block_hash: TIP.index_block_hash,
				burn_block_height: TIP.burn_block_height,
				tx_id: `0x${i}`,
				tx_index: i,
				event_index: i,
				event_type: eventType,
				contract_id: null,
				payload: {},
				ts: "2026-05-02T21:43:00.000Z",
			})),
			next_cursor: null,
		});

		const body = await getStreamsEventsResponse({
			query: params("?types=stx_transfer,print"),
			tip: TIP,
			readEvents,
		});

		expect(body.events.map((event) => event.event_type)).toEqual([
			"stx_transfer",
			"print",
		]);
		expect(body.reorgs).toEqual([]);
	});

	test("full pagination walk over fixture range ends with null cursor", async () => {
		const allEvents = Array.from({ length: 5 }, (_, i) => ({
			cursor: `1:${i}`,
			block_height: 1,
			index_block_hash: TIP.index_block_hash,
			burn_block_height: TIP.burn_block_height,
			tx_id: `0x${i}`,
			tx_index: i,
			event_index: i,
			event_type: "stx_transfer" as const,
			contract_id: null,
			payload: {},
			ts: "2026-05-02T21:43:00.000Z",
		}));
		const readEvents: StreamsEventsReader = async ({ after, limit }) => {
			const start = after ? after.event_index + 1 : 0;
			const events = allEvents.slice(start, start + limit);
			const nextEvent = allEvents[start + limit];
			return {
				events,
				next_cursor: nextEvent ? events.at(-1)?.cursor ?? null : null,
			};
		};

		let cursor: string | null = null;
		const walked: string[] = [];
		do {
			const body = await getStreamsEventsResponse({
				query: params(`?limit=2${cursor ? `&cursor=${cursor}` : ""}`),
				tip: TIP,
				readEvents,
			});
			walked.push(...body.events.map((event) => event.cursor));
			cursor = body.next_cursor;
		} while (cursor);

		expect(walked).toEqual(allEvents.map((event) => event.cursor));
		expect(cursor).toBeNull();
	});

	test("cursor past current clamped tip returns empty page and echoes cursor", async () => {
		const body = await getStreamsEventsResponse({
			query: params("?cursor=99:0"),
			tip: TIP,
			readEvents: async () => {
				throw new Error("should not read events");
			},
		});

		expect(body.events).toEqual([]);
		expect(body.next_cursor).toBe("99:0");
		expect(body.tip).toEqual(TIP);
		expect(body.reorgs).toEqual([]);
	});

	test("types filter can return no events while advancing the cursor", async () => {
		const body = await getStreamsEventsResponse({
			query: params("?types=print"),
			tip: TIP,
			readEvents: async () => ({
				events: [],
				next_cursor: "1:99",
			}),
		});

		expect(body.events).toEqual([]);
		expect(body.next_cursor).toBe("1:99");
		expect(body.reorgs).toEqual([]);
	});

	test("unknown types return a 400-class validation error", async () => {
		await expect(
			getStreamsEventsResponse({
				query: params("?types=contract_call"),
				tip: TIP,
				readEvents: async () => ({ events: [], next_cursor: null }),
			}),
		).rejects.toThrow("Unknown Streams event type: contract_call");
	});
});
