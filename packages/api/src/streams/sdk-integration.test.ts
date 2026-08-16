import { describe, expect, test } from "bun:test";
import { type StreamsEvent, createStreamsClient } from "@secondlayer/sdk";
import { decodeFtTransfer, isFtTransfer } from "@secondlayer/sdk/streams/rows";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import { createStreamsRouter } from "../routes/streams.ts";
import { STREAMS_READ_SCOPE, type StreamsTokenStore } from "./auth.ts";
import type { StreamsEventsReader } from "./events.ts";

// No paid ladder left in the default seeds; inject an "internal" tenant
// (unlimited retention) through the `tokens` seam instead of a static token.
const INTERNAL_KEY = "sk-sl_streams_internal_fixture";
const TEST_TOKENS: StreamsTokenStore = new Map([
	[
		INTERNAL_KEY,
		{
			tenant_id: "tenant_streams_internal_fixture",
			tier: "internal",
			scopes: [STREAMS_READ_SCOPE],
		},
	],
]);
const TIP = {
	block_height: 10,
	block_hash: "0x01",
	burn_block_height: 20,
	finalized_height: 4,
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
			tokens: TEST_TOKENS,
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
			apiKey: INTERNAL_KEY,
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				return app.fetch(request);
			},
		});

		// Tip now advertises the seekable floor; internal tier has no retention
		// cutoff at all (unlimited), so there's no floor to report.
		await expect(client.tip()).resolves.toEqual({
			...TIP,
			oldest_seekable_height: null,
			oldest_cursor: null,
		});

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
