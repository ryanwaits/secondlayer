import { describe, expect, test } from "bun:test";
import {
	createStreamsClient,
	decodeFtTransfer,
	isFtTransfer,
	type StreamsEvent,
} from "@secondlayer/sdk";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import { createStreamsRouter } from "../routes/streams.ts";
import type { StreamsEventsReader } from "./events.ts";

const BUILD_KEY = "sk-sl_streams_build_test";
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
			asset_identifier: "SP1.token::sbtc",
			sender: "SP1",
			recipient: "SP2",
			amount: "250000",
		},
		ts: "2026-05-02T21:43:00.000Z",
	};
}

function createApp(readEvents: StreamsEventsReader) {
	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/v1/streams",
		createStreamsRouter({
			getTip: () => TIP,
			readEvents,
			readReorgs: async () => [],
		}),
	);
	return app;
}

describe("@secondlayer/sdk Streams integration", () => {
	test("exercises HTTP client, consumers, and ft_transfer helper", async () => {
		const events = [event("1:0", 0), event("1:1", 1)];
		const app = createApp(async ({ after, limit }) => {
			const start = after ? after.event_index + 1 : 0;
			const page = events.slice(start, start + limit);
			const hasMore = start + limit < events.length;
			return {
				events: page,
				next_cursor: hasMore ? (page.at(-1)?.cursor ?? null) : null,
			};
		});
		const client = createStreamsClient({
			apiKey: BUILD_KEY,
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				return app.fetch(request);
			},
		});

		await expect(client.tip()).resolves.toEqual(TIP);

		const envelope = await client.events.list({
			types: ["ft_transfer"],
			limit: 1,
		});
		expect(envelope.events.map((item) => item.cursor)).toEqual(["1:0"]);
		expect(envelope.next_cursor).toBe("1:0");

		const seen: string[] = [];
		for await (const item of client.events.stream({
			types: ["ft_transfer"],
			batchSize: 1,
		})) {
			expect(isFtTransfer(item)).toBe(true);
			const decoded = decodeFtTransfer(item);
			seen.push(decoded.cursor);
			if (seen.length === 2) break;
		}

		expect(seen).toEqual(["1:0", "1:1"]);

		const consumed: string[] = [];
		await client.events.consume({
			types: ["ft_transfer"],
			batchSize: 1,
			maxPages: 2,
			onBatch: (items, page) => {
				consumed.push(...items.map((item) => item.cursor));
				return page.next_cursor;
			},
		});

		expect(consumed).toEqual(["1:0", "1:1"]);
	});
});
