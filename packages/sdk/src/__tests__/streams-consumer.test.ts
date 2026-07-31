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

	test("rolls back a reorg, rewinds to the fork foot (re-reading fork:0), and dedups re-reported reorgs", async () => {
		const r = reorg({ fork_point_height: 5 });
		// Rewind to the FOOT of the fork point (exclusive of 4:MAX) re-includes the
		// fork block's first event (5:0) — the boundary row the earlier `5:0`
		// rewind silently dropped.
		const rewind = "4:2147483647";
		const byCursor: Record<string, StreamsEventsEnvelope> = {
			null: {
				events: [event("6:0", 0)],
				next_cursor: "6:0",
				tip: TIP,
				reorgs: [r],
			},
			[rewind]: {
				events: [
					event("5:0", 0, { block_height: 5 }),
					event("6:0", 1),
					event("7:0", 2),
				],
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

		// Handled once (not on the re-reported page), rewound to the fork foot.
		expect(rollbacks).toEqual([{ fork: 5, cursor: rewind }]);
		// Page that carried the fresh reorg is skipped; the re-read is applied —
		// and it INCLUDES the fork-point's first event (5:0).
		expect(applied).toEqual(["5:0", "6:0", "7:0"]);
		expect(requestedCursors).toEqual([null, rewind, "7:0"]);
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

	test("finalizedOnly throws when onBatch commits past the finalized boundary", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				jsonResponse({
					events: [
						event("6:0", 0, { block_height: 6, finalized: true }),
						event("8:0", 1, { block_height: 8, finalized: false }),
					],
					next_cursor: "8:0",
					tip: TIP,
					reorgs: [],
				}),
		});

		// The classic mistake: returning envelope.next_cursor, which points past
		// the filtered unfinalized tail. Committing it drops 8:0 forever.
		await expect(
			client.events.consume({
				finalizedOnly: true,
				fromCursor: null,
				batchSize: 10,
				maxPages: 1,
				onBatch: (_events, envelope) => envelope.next_cursor,
			}),
		).rejects.toThrow(/finalizedOnly|finalized event/);
	});

	test("finalizedOnly accepts returning the delivered checkpoint or below", async () => {
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
			// Committed less than delivered (e.g. a partial write) — legal.
			onBatch: () => "6:0",
		});
		expect(result.cursor).toBe("6:0");
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

describe("consume progress context", () => {
	test("reports the highest block reached and its distance from the tip", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				jsonResponse({
					events: [
						event("4:0", 0, { block_height: 4 }),
						event("6:1", 1, { block_height: 6 }),
					],
					next_cursor: "6:1",
					tip: TIP,
					reorgs: [],
				}),
		});

		const seen: Array<{ height: number | null; behind: number | null }> = [];
		await client.events.consume({
			batchSize: 2,
			maxPages: 1,
			onBatch: (_events, envelope, ctx) => {
				seen.push({ height: ctx.height, behind: ctx.blocksBehind });
				return envelope.next_cursor;
			},
		});

		expect(seen).toEqual([{ height: 6, behind: 4 }]);
	});

	test("rolls the reached height back below the fork point after a reorg", async () => {
		let served = 0;
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () => {
				served++;
				if (served === 1) {
					return jsonResponse({
						events: [event("9:0", 0, { block_height: 9 })],
						next_cursor: "9:0",
						tip: TIP,
						reorgs: [],
					});
				}
				if (served === 2) {
					return jsonResponse({
						events: [],
						next_cursor: "9:0",
						tip: TIP,
						reorgs: [reorg({ fork_point_height: 5 })],
					});
				}
				return jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [reorg({ fork_point_height: 5 })],
				});
			},
		});

		const heights: Array<number | null> = [];
		await client.events.consume({
			emptyBackoffMs: 0,
			maxEmptyPolls: 1,
			onBatch: (_events, _envelope, ctx) => {
				heights.push(ctx.height);
				return ctx.cursor;
			},
			onReorg: () => {},
		});

		// Parity with the Index loop: blocks at or above the fork are gone, so 4
		// is the highest still-canonical block.
		expect(heights).toEqual([9, 4]);
	});
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("client.events.consume — labelled filter maps", () => {
	function labelled(
		cursor: string,
		index: number,
		eventType: StreamsEvent["event_type"],
		matched: string[],
	): StreamsEvent {
		return {
			...event(cursor, index),
			event_type: eventType,
			matched,
		} as StreamsEvent;
	}

	test("sends filters as a JSON query param and dispatches per label", async () => {
		let sentFilters: string | null = null;
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async (input) => {
				const url = new URL(input.toString());
				sentFilters = url.searchParams.get("filters");
				return jsonResponse({
					events: [
						labelled("1:0", 0, "ft_transfer", ["peg"]),
						labelled("1:1", 1, "stx_transfer", ["treasury"]),
					],
					next_cursor: "1:1",
					tip: TIP,
					reorgs: [],
				});
			},
		});

		const peg: string[] = [];
		const treasury: string[] = [];
		await client.events.consume({
			fromCursor: null,
			maxPages: 1,
			filters: {
				peg: { types: ["ft_transfer"], assetIdentifier: "SP1.token::token" },
				treasury: { types: ["stx_transfer"] },
			},
			on: {
				peg: (events) => {
					// Narrowed by the label's declared `types` — no guard needed.
					peg.push(...events.map((e) => e.payload.asset_identifier));
				},
				treasury: (events) => {
					treasury.push(...events.map((e) => e.cursor));
				},
			},
		});

		expect(JSON.parse(sentFilters ?? "null")).toEqual({
			peg: { types: ["ft_transfer"], assetIdentifier: "SP1.token::token" },
			treasury: { types: ["stx_transfer"] },
		});
		expect(peg).toEqual(["SP1.token::token"]);
		expect(treasury).toEqual(["1:1"]);
	});

	test("an event matching two labels reaches both handlers", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				jsonResponse({
					events: [labelled("1:0", 0, "ft_transfer", ["all", "peg"])],
					next_cursor: "1:0",
					tip: TIP,
					reorgs: [],
				}),
		});

		const seen: string[] = [];
		await client.events.consume({
			fromCursor: null,
			maxPages: 1,
			filters: { all: {}, peg: { types: ["ft_transfer"] } },
			on: {
				all: (events) => {
					seen.push(`all:${events.length}`);
				},
				peg: (events) => {
					seen.push(`peg:${events.length}`);
				},
			},
		});

		expect(seen).toEqual(["all:1", "peg:1"]);
	});

	test("onBatch still sees the whole page and owns the checkpoint", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				jsonResponse({
					events: [
						labelled("1:0", 0, "ft_transfer", ["peg"]),
						labelled("1:1", 1, "stx_transfer", []),
					],
					next_cursor: "1:1",
					tip: TIP,
					reorgs: [],
				}),
		});

		let pageSize = 0;
		const result = await client.events.consume({
			fromCursor: null,
			maxPages: 1,
			filters: { peg: { types: ["ft_transfer"] } },
			on: { peg: () => {} },
			onBatch: (events) => {
				pageSize = events.length;
				return "9:9";
			},
		});

		expect(pageSize).toBe(2);
		expect(result.cursor).toBe("9:9");
	});
});

describe("sink capabilities", () => {
	const finalizedOnlySink = {
		capabilities: { finalizedOnly: true },
		async loadCursor() {
			return null;
		},
		async commitBatch(_cursor: string, write: (tx: unknown) => unknown) {
			await write({});
		},
		async rollback() {
			throw new Error("unreachable: finalizedOnly sinks never see reorgs");
		},
	};

	test("a finalizedOnly sink following the tip throws BEFORE the first fetch", async () => {
		let fetched = 0;
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () => {
				fetched++;
				return jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [],
				});
			},
		});

		await expect(
			client.events.consume({
				sink: finalizedOnlySink,
				maxPages: 1,
				onBatch: () => {},
			}),
		).rejects.toThrow(/finalizedOnly/);
		// Loudly at startup — not after data already flowed to the sink.
		expect(fetched).toBe(0);
	});

	test("the same sink is accepted once finalizedOnly: true is set", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				jsonResponse({ events: [], next_cursor: null, tip: TIP, reorgs: [] }),
		});

		const result = await client.events.consume({
			sink: finalizedOnlySink,
			finalizedOnly: true,
			mode: "bounded",
			maxPages: 1,
			onBatch: () => {},
		});
		expect(result.pages).toBe(1);
	});
});

describe("resume position reporting", () => {
	test("a restart into a quiet tail reports the resume position, not nulls", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				jsonResponse({ events: [], next_cursor: null, tip: TIP, reorgs: [] }),
		});

		const seen: Array<{
			cursor: string | null;
			height: number | null;
			blocksBehind: number | null;
		}> = [];
		await client.events.consume({
			fromCursor: "5:0",
			mode: "bounded",
			maxPages: 1,
			emptyBackoffMs: 0,
			onProgress: (ctx) =>
				seen.push({
					cursor: ctx.cursor,
					height: ctx.height,
					blocksBehind: ctx.blocksBehind,
				}),
			onBatch: () => {},
		});

		expect(seen).toEqual([
			{ cursor: "5:0", height: 5, blocksBehind: TIP.block_height - 5 },
		]);
	});
});
