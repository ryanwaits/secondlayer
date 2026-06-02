import { describe, expect, test } from "bun:test";
import {
	type StreamsEvent,
	type StreamsEventsEnvelope,
	type StreamsReorg,
	createStreamsClient,
} from "../index.ts";

const TIP = {
	block_height: 10,
	block_hash: "0x01",
	burn_block_height: 20,
	lag_seconds: 0,
};

function event(
	cursor: string,
	index: number,
	overrides: { block_height?: number; finalized?: boolean } = {},
): StreamsEvent {
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
		ts: "2026-05-02T21:43:00.000Z",
		...overrides,
	};
}

function reorg(overrides: Partial<StreamsReorg> = {}): StreamsReorg {
	return {
		detected_at: "2026-05-02T22:00:00.000Z",
		fork_point_height: 5,
		orphaned_range: { from: "6:0", to: "8:0" },
		new_canonical_tip: "8:0",
		...overrides,
	};
}

describe("client.events.consume", () => {
	test("paginates in order and advances the cursor", async () => {
		const pages: StreamsEventsEnvelope[] = [
			{
				events: [event("1:0", 0), event("1:1", 1)],
				next_cursor: "1:1",
				tip: TIP,
				reorgs: [],
			},
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

	test("onBatch receives the checkpoint cursor (next_cursor) in tail mode", async () => {
		let ctxCursor: string | null | undefined;
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				jsonResponse({
					events: [event("1:0", 0)],
					next_cursor: "1:0",
					tip: TIP,
					reorgs: [],
				}),
		});

		await client.events.consume({
			fromCursor: null,
			batchSize: 10,
			maxPages: 1,
			onBatch: (_events, envelope, ctx) => {
				ctxCursor = ctx.cursor;
				expect(ctx.cursor).toBe(envelope.next_cursor);
			},
		});

		expect(ctxCursor).toBe("1:0");
	});

	test("rolls back a reorg, rewinds the cursor, and dedups re-reported reorgs", async () => {
		const r = reorg({ fork_point_height: 5 });
		const byCursor: Record<string, StreamsEventsEnvelope> = {
			null: {
				events: [event("6:0", 0)],
				next_cursor: "6:0",
				tip: TIP,
				reorgs: [r],
			},
			"5:0": {
				events: [event("6:0", 0), event("7:0", 1)],
				next_cursor: "7:0",
				tip: TIP,
				reorgs: [r], // re-reported on the re-read; must not re-trigger
			},
			"7:0": { events: [], next_cursor: "7:0", tip: TIP, reorgs: [] },
		};
		const requestedCursors: Array<string | null> = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async (input) => {
				const c = new URL(input.toString()).searchParams.get("cursor");
				requestedCursors.push(c);
				return jsonResponse(byCursor[c ?? "null"]);
			},
		});

		const rollbacks: Array<{ fork: number; cursor: string }> = [];
		const applied: string[] = [];
		const result = await client.events.consume({
			fromCursor: null,
			batchSize: 10,
			emptyBackoffMs: 0,
			maxEmptyPolls: 1,
			onBatch: (events) => {
				applied.push(...events.map((e) => e.cursor));
			},
			onReorg: (detected, ctx) => {
				rollbacks.push({
					fork: detected.fork_point_height,
					cursor: ctx.cursor,
				});
			},
		});

		// Handled once (not on the re-reported page), rewound to "<fork>:0".
		expect(rollbacks).toEqual([{ fork: 5, cursor: "5:0" }]);
		// Page that carried the fresh reorg is skipped; the re-read is applied.
		expect(applied).toEqual(["6:0", "7:0"]);
		expect(requestedCursors).toEqual([null, "5:0", "7:0"]);
		expect(result.cursor).toBe("7:0");
	});

	test("finalizedOnly emits only finalized events, checkpointing the last one", async () => {
		let ctxCursor: string | null | undefined;
		const emitted: string[] = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				jsonResponse({
					events: [
						event("6:0", 0, { block_height: 6, finalized: true }),
						event("7:0", 1, { block_height: 7, finalized: true }),
						event("8:0", 2, { block_height: 8, finalized: false }),
					],
					next_cursor: "8:0",
					tip: TIP,
					reorgs: [],
				}),
		});

		const result = await client.events.consume({
			finalizedOnly: true,
			fromCursor: null,
			batchSize: 10,
			maxPages: 1,
			onBatch: (events, _envelope, ctx) => {
				emitted.push(...events.map((e) => e.cursor));
				ctxCursor = ctx.cursor;
			},
		});

		expect(emitted).toEqual(["6:0", "7:0"]);
		// Advances to the last finalized event, not next_cursor ("8:0").
		expect(ctxCursor).toBe("7:0");
		expect(result.cursor).toBe("7:0");
	});

	test("finalizedOnly never fires onReorg", async () => {
		let reorgCalls = 0;
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				jsonResponse({
					events: [event("6:0", 0, { block_height: 6, finalized: true })],
					next_cursor: "6:0",
					tip: TIP,
					reorgs: [reorg({ fork_point_height: 5 })],
				}),
		});

		await client.events.consume({
			finalizedOnly: true,
			fromCursor: null,
			batchSize: 10,
			maxPages: 1,
			onBatch: () => undefined,
			onReorg: () => {
				reorgCalls++;
			},
		});

		expect(reorgCalls).toBe(0);
	});
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
