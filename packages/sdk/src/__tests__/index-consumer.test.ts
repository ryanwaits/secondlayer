import { afterEach, describe, expect, test } from "bun:test";
import type {
	ContractCallsEnvelope,
	EventsEnvelope,
	IndexContractCall,
	IndexEvent,
	IndexReorg,
	IndexTip,
} from "../index.ts";
import { Index, ValidationError } from "../index.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const TIP: IndexTip = {
	block_height: 10,
	finalized_height: 7,
	lag_seconds: 0,
};

function event(cursor: string, index: number, block_height = 1): IndexEvent {
	return {
		cursor,
		block_height,
		tx_id: `0x${index}`,
		tx_index: index,
		event_index: index,
		event_type: "ft_transfer",
		contract_id: "SP1.token",
		asset_identifier: "SP1.token::token",
		sender: "SP1",
		recipient: "SP2",
		amount: "1",
	};
}

function call(
	cursor: string,
	index: number,
	block_height = 1,
): IndexContractCall {
	return {
		cursor,
		block_height,
		tx_id: `0x${index}`,
		tx_index: index,
		contract_id: "SP1.marketplace",
		function_name: "buy-asset",
		sender: "SP1",
		status: "success",
		args: [],
		result: null,
		result_hex: null,
	};
}

function reorg(overrides: Partial<IndexReorg> = {}): IndexReorg {
	return {
		id: "r1",
		detected_at: "2026-06-12T22:00:00.000Z",
		fork_point_height: 5,
		old_index_block_hash: "0xold",
		new_index_block_hash: "0xnew",
		orphaned_range: { from: "6:0", to: "8:0" },
		new_canonical_tip: "8:0",
		...overrides,
	};
}

function clientFor(
	handler: (url: URL) => unknown,
	requested?: {
		cursors: Array<string | null>;
		fromHeights: Array<string | null>;
	},
): Index {
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = new URL(input.toString());
		requested?.cursors.push(url.searchParams.get("cursor"));
		requested?.fromHeights.push(url.searchParams.get("from_height"));
		return jsonResponse(handler(url));
	}) as unknown as typeof fetch;
	return new Index();
}

describe("index.events.consume", () => {
	test("paginates in order, advances the cursor, and passes fromHeight only on the first page", async () => {
		const pages: EventsEnvelope[] = [
			{
				events: [event("1:0", 0), event("1:1", 1)],
				next_cursor: "1:1",
				tip: TIP,
				reorgs: [],
			},
			{ events: [event("1:2", 2)], next_cursor: "1:2", tip: TIP, reorgs: [] },
		];
		const requested = { cursors: [], fromHeights: [] } as {
			cursors: Array<string | null>;
			fromHeights: Array<string | null>;
		};
		const seen: string[] = [];
		const client = clientFor(() => pages.shift(), requested);

		const result = await client.events.consume({
			eventType: "ft_transfer",
			fromHeight: 0,
			batchSize: 2,
			maxPages: 2,
			onBatch: (events, envelope) => {
				seen.push(...events.map((e) => e.cursor));
				return envelope.next_cursor;
			},
		});

		expect(seen).toEqual(["1:0", "1:1", "1:2"]);
		expect(requested.cursors).toEqual([null, "1:1"]);
		// from_height accompanies the cursorless first page only.
		expect(requested.fromHeights).toEqual(["0", null]);
		expect(result.cursor).toBe("1:2");
	});

	test("backs off when caught up at the tip", async () => {
		const client = clientFor(() => ({
			events: [],
			next_cursor: null,
			tip: TIP,
			reorgs: [],
		}));

		const result = await client.events.consume({
			eventType: "ft_transfer",
			fromCursor: "1:2",
			emptyBackoffMs: 0,
			maxEmptyPolls: 2,
			onBatch: () => undefined,
		});

		expect(result.emptyPolls).toBe(2);
		expect(result.cursor).toBe("1:2");
	});

	test("bounded mode exits on the first empty page", async () => {
		let requests = 0;
		const client = clientFor(() => {
			requests++;
			return { events: [], next_cursor: null, tip: TIP, reorgs: [] };
		});

		const result = await client.events.consume({
			eventType: "ft_transfer",
			mode: "bounded",
			fromCursor: "1:2",
			onBatch: () => undefined,
		});

		expect(requests).toBe(1);
		expect(result.emptyPolls).toBe(1);
	});

	test("onBatch receives the checkpoint cursor (next_cursor) in tail mode", async () => {
		let ctxCursor: string | null | undefined;
		const client = clientFor(() => ({
			events: [event("2:0", 0)],
			next_cursor: "2:0",
			tip: TIP,
			reorgs: [],
		}));

		await client.events.consume({
			eventType: "ft_transfer",
			fromCursor: null,
			maxPages: 1,
			onBatch: (_events, _envelope, ctx) => {
				ctxCursor = ctx.cursor;
			},
		});

		expect(ctxCursor).toBe("2:0");
	});

	test("rolls back a reorg, rewinds to the fork foot (re-reading fork:0), and dedups re-reported reorgs", async () => {
		const r = reorg({ fork_point_height: 5 });
		// Rewind cursor is the FOOT of the fork point (exclusive of 4:MAX), so the
		// re-read re-includes the fork block's first event (5:0) — the boundary row
		// the earlier `5:0` rewind silently dropped.
		const rewind = "4:2147483647";
		const byCursor: Record<string, EventsEnvelope> = {
			// Checkpoint at 9:0 sits ABOVE the fork, so the fork is a real
			// rollback of rows already written.
			"9:0": {
				events: [event("10:0", 0, 10)],
				next_cursor: "10:0",
				tip: TIP,
				reorgs: [r],
			},
			[rewind]: {
				events: [event("5:0", 0, 5), event("6:0", 1, 6), event("7:0", 2, 7)],
				next_cursor: "7:0",
				tip: TIP,
				reorgs: [r], // re-reported on the re-read; must not re-trigger
			},
			"7:0": { events: [], next_cursor: "7:0", tip: TIP, reorgs: [] },
		};
		const requested = { cursors: [], fromHeights: [] } as {
			cursors: Array<string | null>;
			fromHeights: Array<string | null>;
		};
		const client = clientFor(
			(url) => byCursor[url.searchParams.get("cursor") ?? "null"],
			requested,
		);

		const rollbacks: Array<{ fork: number; cursor: string | null }> = [];
		const applied: string[] = [];
		const result = await client.events.consume({
			eventType: "ft_transfer",
			fromCursor: "9:0",
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
		expect(requested.cursors).toEqual(["9:0", rewind, "7:0"]);
		expect(result.cursor).toBe("7:0");
	});

	test("a fork above the checkpoint never rewinds: the page is delivered and the sink keeps its cursor", async () => {
		// Checkpoint 100:5, page 101..200 reporting a fork at 150. Rewinding
		// would commit 149:MAX to the sink and skip rows 101..149 for good.
		const fork = reorg({
			fork_point_height: 150,
			orphaned_range: { from: "150:0", to: "160:0" },
			new_canonical_tip: "161:0",
		});
		const tip = { ...TIP, block_height: 200 };
		const requested = { cursors: [], fromHeights: [] } as {
			cursors: Array<string | null>;
			fromHeights: Array<string | null>;
		};
		let served = 0;
		const client = clientFor(() => {
			served++;
			if (served === 1) {
				return {
					events: Array.from({ length: 100 }, (_, k) =>
						event(`${101 + k}:0`, k, 101 + k),
					),
					next_cursor: "200:0",
					tip,
					reorgs: [fork],
				};
			}
			return { events: [], next_cursor: "200:0", tip, reorgs: [fork] };
		}, requested);

		const rollbacks: Array<[number, string | null]> = [];
		const committed: string[] = [];
		let cursor: string | null = "100:5";
		const delivered: string[] = [];
		await client.events.consume({
			eventType: "ft_transfer",
			mode: "bounded",
			sink: {
				loadCursor: async () => cursor,
				commitBatch: async (next, write) => {
					await write(undefined as never);
					cursor = next;
					committed.push(next);
				},
				rollback: async (forkPoint, rewind) => {
					rollbacks.push([forkPoint, rewind]);
					cursor = rewind;
				},
			},
			onBatch: (events) => {
				delivered.push(...events.map((e) => e.cursor));
			},
		});

		expect(rollbacks).toEqual([]);
		expect(delivered).toHaveLength(100);
		expect(delivered[0]).toBe("101:0");
		expect(committed).toEqual(["200:0"]);
		expect(cursor).toBe("200:0");
		expect(requested.cursors).toEqual(["100:5", "200:0"]);
	});

	test("a malformed fork point is refused before the sink rolls anything back", async () => {
		for (const fork_point_height of [Number.NaN, -1]) {
			const client = clientFor(() => ({
				events: [],
				next_cursor: "10:0",
				tip: TIP,
				reorgs: [reorg({ fork_point_height })],
			}));
			const rollbacks: number[] = [];
			await expect(
				client.events.consume({
					eventType: "ft_transfer",
					maxPages: 2,
					sink: {
						loadCursor: async () => "10:0",
						commitBatch: async (_c, write) => {
							await write(undefined as never);
						},
						rollback: async (forkPoint) => {
							rollbacks.push(forkPoint);
						},
					},
					onBatch: () => undefined,
				}),
			).rejects.toBeInstanceOf(ValidationError);
			expect(rollbacks).toEqual([]);
		}
	});

	test("a rewind deeper than maxRollbackDepth is refused unless the ceiling is raised", async () => {
		const deep = reorg({ fork_point_height: 10 });
		const page = () => ({
			events: [],
			next_cursor: "5000:3",
			tip: { ...TIP, block_height: 5000 },
			reorgs: [deep],
		});
		const rollbacks: number[] = [];
		await expect(
			clientFor(page).events.consume({
				eventType: "ft_transfer",
				fromCursor: "5000:3",
				maxPages: 2,
				onBatch: () => undefined,
				onReorg: (r) => {
					rollbacks.push(r.fork_point_height);
				},
			}),
		).rejects.toThrow(/maxRollbackDepth/);
		expect(rollbacks).toEqual([]);

		await clientFor(page).events.consume({
			eventType: "ft_transfer",
			fromCursor: "5000:3",
			maxPages: 1,
			maxRollbackDepth: 5000,
			onBatch: () => undefined,
			onReorg: (r) => {
				rollbacks.push(r.fork_point_height);
			},
		});
		expect(rollbacks).toEqual([10]);
	});

	test("finalizedOnly emits only rows at or below tip.finalized_height, checkpointing the last one", async () => {
		let ctxCursor: string | null | undefined;
		const emitted: string[] = [];
		const client = clientFor(() => ({
			events: [event("6:0", 0, 6), event("7:0", 1, 7), event("8:0", 2, 8)],
			next_cursor: "8:0",
			tip: TIP, // finalized_height: 7
			reorgs: [],
		}));

		const result = await client.events.consume({
			eventType: "ft_transfer",
			finalizedOnly: true,
			fromCursor: null,
			maxPages: 1,
			onBatch: (events, _envelope, ctx) => {
				emitted.push(...events.map((e) => e.cursor));
				ctxCursor = ctx.cursor;
			},
		});

		expect(emitted).toEqual(["6:0", "7:0"]);
		// Advances to the last finalized row, not next_cursor ("8:0").
		expect(ctxCursor).toBe("7:0");
		expect(result.cursor).toBe("7:0");
	});

	test("finalizedOnly throws when onBatch commits past the finalized boundary", async () => {
		const client = clientFor(() => ({
			events: [event("6:0", 0, 6), event("8:0", 1, 8)],
			next_cursor: "8:0",
			tip: TIP, // finalized_height: 7 — 8:0 is filtered out
			reorgs: [],
		}));

		await expect(
			client.events.consume({
				eventType: "ft_transfer",
				finalizedOnly: true,
				fromCursor: null,
				maxPages: 1,
				// The quickstart's habit: envelope.next_cursor. Under finalizedOnly
				// it points past the undelivered tail — committing it drops 8:0.
				onBatch: (_events, envelope) => envelope.next_cursor,
			}),
		).rejects.toThrow(/finalizedOnly|finalized event/);
	});

	test("finalizedOnly never fires onReorg", async () => {
		let reorgCalls = 0;
		const client = clientFor(() => ({
			events: [event("6:0", 0, 6)],
			next_cursor: "6:0",
			tip: TIP,
			reorgs: [reorg()],
		}));

		await client.events.consume({
			eventType: "ft_transfer",
			finalizedOnly: true,
			fromCursor: null,
			maxPages: 1,
			onBatch: () => undefined,
			onReorg: () => {
				reorgCalls++;
			},
		});

		expect(reorgCalls).toBe(0);
	});
});

describe("index.contractCalls.consume", () => {
	test("consumes the contract_calls envelope and forwards call filters", async () => {
		const pages: ContractCallsEnvelope[] = [
			{
				contract_calls: [call("1:0", 0), call("1:1", 1)],
				next_cursor: "1:1",
				tip: TIP,
				reorgs: [],
			},
			{ contract_calls: [], next_cursor: null, tip: TIP, reorgs: [] },
		];
		const urls: URL[] = [];
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = new URL(input.toString());
			urls.push(url);
			return jsonResponse(pages.shift());
		}) as unknown as typeof fetch;
		const client = new Index();

		const applied: string[] = [];
		const result = await client.contractCalls.consume({
			contractId: "SP1.marketplace",
			functionName: "buy-asset",
			fromHeight: 0,
			emptyBackoffMs: 0,
			maxEmptyPolls: 1,
			onBatch: (calls) => {
				applied.push(...calls.map((c) => c.cursor));
			},
		});

		expect(applied).toEqual(["1:0", "1:1"]);
		expect(result.cursor).toBe("1:1");
		expect(urls[0]?.pathname).toBe("/v1/index/contract-calls");
		expect(urls[0]?.searchParams.get("contract_id")).toBe("SP1.marketplace");
		expect(urls[0]?.searchParams.get("function_name")).toBe("buy-asset");
		expect(urls[0]?.searchParams.get("from_height")).toBe("0");
		expect(urls[1]?.searchParams.get("from_height")).toBeNull();
		expect(urls[1]?.searchParams.get("cursor")).toBe("1:1");
	});

	test("a fromCursor consume never sends from_cursor alongside cursor", async () => {
		// fromCursor is the loop's starting checkpoint, not a filter. The API
		// rejects cursor + from_cursor together, so leaking it into the page
		// request would 400 every page after the first.
		const pages = [
			{
				contract_calls: [call("2:0", 0, 2)],
				next_cursor: "2:0",
				tip: TIP,
				reorgs: [],
			},
			{ contract_calls: [], next_cursor: null, tip: TIP, reorgs: [] },
		];
		const urls: URL[] = [];
		globalThis.fetch = (async (input: string | URL | Request) => {
			urls.push(new URL(input.toString()));
			return jsonResponse(pages.shift());
		}) as unknown as typeof fetch;

		await new Index().contractCalls.consume({
			fromCursor: "1:9",
			contractId: "SP1.marketplace",
			emptyBackoffMs: 0,
			maxEmptyPolls: 1,
			onBatch: () => undefined,
		});

		expect(urls.length).toBeGreaterThan(0);
		for (const url of urls) {
			expect(url.searchParams.get("from_cursor")).toBeNull();
			expect(url.searchParams.get("contract_id")).toBe("SP1.marketplace");
		}
		expect(urls[0]?.searchParams.get("cursor")).toBe("1:9");
	});
});

describe("index.sbtc consumers", () => {
	function sbtcEvent(cursor: string, blockHeight: number, index: number) {
		return {
			cursor,
			block_height: blockHeight,
			tx_id: `0x${index}`,
			tx_index: index,
			event_index: index,
			topic: "completed-deposit",
			request_id: null,
			amount: "1000",
			sender: "SP1",
		};
	}

	test("events.consume pages the peg log and keeps the topic filter on every request", async () => {
		const pages = [
			{
				events: [sbtcEvent("1:0", 1, 0), sbtcEvent("2:1", 2, 1)],
				next_cursor: "2:1",
				tip: TIP,
				reorgs: [],
			},
			{
				events: [sbtcEvent("3:0", 3, 2)],
				next_cursor: "3:0",
				tip: TIP,
				reorgs: [],
			},
		];
		const urls: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request) => {
			urls.push(input.toString());
			return jsonResponse(pages.shift());
		}) as unknown as typeof fetch;

		const seen: string[] = [];
		const result = await new Index().sbtc.events.consume({
			topic: "withdrawal-accept",
			batchSize: 2,
			maxPages: 2,
			onBatch: (events, _envelope, ctx) => {
				seen.push(...events.map((e) => e.cursor));
				return ctx.cursor;
			},
		});

		expect(seen).toEqual(["1:0", "2:1", "3:0"]);
		expect(result.cursor).toBe("3:0");
		expect(urls[0]).toContain("/v1/index/sbtc/events");
		// The filter has to survive pagination, or page two silently widens to
		// every topic and the mirror fills with rows the caller never asked for.
		expect(urls[0]).toContain("topic=withdrawal-accept");
		expect(urls[1]).toContain("topic=withdrawal-accept");
		expect(urls[1]).toContain("cursor=2%3A1");
	});

	test("events.consume rolls back on a reorg like every other index feed", async () => {
		let served = 0;
		globalThis.fetch = (async () => {
			served++;
			if (served === 1) {
				return jsonResponse({
					events: [sbtcEvent("9:0", 9, 0)],
					next_cursor: "9:0",
					tip: TIP,
					reorgs: [],
				});
			}
			return jsonResponse({
				events: [],
				next_cursor: null,
				tip: TIP,
				reorgs: [reorg()],
			});
		}) as unknown as typeof fetch;

		const rolledBackFrom: number[] = [];
		const heights: Array<number | null> = [];
		await new Index().sbtc.events.consume({
			emptyBackoffMs: 0,
			maxEmptyPolls: 1,
			onBatch: (_events, _envelope, ctx) => {
				heights.push(ctx.height);
				return ctx.cursor;
			},
			onReorg: (r) => {
				rolledBackFrom.push(r.fork_point_height);
			},
		});

		expect(rolledBackFrom).toEqual([5]);
		expect(heights).toEqual([9, 4]);
	});

	test("deposits.consume reads the deposits collection, not events", async () => {
		const urls: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request) => {
			urls.push(input.toString());
			return jsonResponse({
				deposits: [
					{ ...sbtcEvent("4:0", 4, 0), bitcoin_txid: "0xabc" },
					{ ...sbtcEvent("5:0", 5, 1), bitcoin_txid: "0xdef" },
				],
				next_cursor: "5:0",
				tip: TIP,
				reorgs: [],
			});
		}) as unknown as typeof fetch;

		const txids: Array<string | null> = [];
		await new Index().sbtc.deposits.consume({
			confirmed: true,
			maxPages: 1,
			onBatch: (deposits, _envelope, ctx) => {
				txids.push(...deposits.map((d) => d.bitcoin_txid));
				return ctx.cursor;
			},
		});

		expect(txids).toEqual(["0xabc", "0xdef"]);
		expect(urls[0]).toContain("/v1/index/sbtc/deposits");
		expect(urls[0]).toContain("confirmed=true");
	});
});

describe("consume progress context", () => {
	test("reports the highest block reached and its distance from the tip", async () => {
		const pages: EventsEnvelope[] = [
			{
				events: [event("4:0", 0, 4), event("6:1", 1, 6)],
				next_cursor: "6:1",
				tip: TIP,
				reorgs: [],
			},
		];
		const seen: Array<{ height: number | null; behind: number | null }> = [];
		const client = clientFor(() => pages.shift());

		await client.events.consume({
			eventType: "ft_transfer",
			batchSize: 2,
			maxPages: 1,
			onBatch: (_events, envelope, ctx) => {
				seen.push({ height: ctx.height, behind: ctx.blocksBehind });
				return envelope.next_cursor;
			},
		});

		// Last row of the page is the highest block; tip is 10.
		expect(seen).toEqual([{ height: 6, behind: 4 }]);
	});

	test("holds the last known height across empty pages at the tip", async () => {
		let served = 0;
		const client = clientFor(() => {
			served++;
			return served === 1
				? {
						events: [event("8:0", 0, 8)],
						next_cursor: "8:0",
						tip: TIP,
						reorgs: [],
					}
				: { events: [], next_cursor: "8:0", tip: TIP, reorgs: [] };
		});

		const heights: Array<number | null> = [];
		await client.events.consume({
			eventType: "ft_transfer",
			emptyBackoffMs: 0,
			maxEmptyPolls: 2,
			onBatch: (_events, _envelope, ctx) => {
				heights.push(ctx.height);
				return ctx.cursor;
			},
		});

		// An empty page is the normal case at the tip — it must not reset progress
		// to null, or a health check reads a live loop as unknown.
		expect(heights).toEqual([8, 8, 8]);
	});

	test("rolls the reached height back below the fork point after a reorg", async () => {
		let served = 0;
		const client = clientFor(() => {
			served++;
			if (served === 1) {
				return {
					events: [event("9:0", 0, 9)],
					next_cursor: "9:0",
					tip: TIP,
					reorgs: [],
				};
			}
			if (served === 2) {
				// fork_point_height 5 — blocks 5 and up are no longer canonical.
				return { events: [], next_cursor: "9:0", tip: TIP, reorgs: [reorg()] };
			}
			return { events: [], next_cursor: null, tip: TIP, reorgs: [reorg()] };
		});

		const heights: Array<number | null> = [];
		await client.events.consume({
			eventType: "ft_transfer",
			emptyBackoffMs: 0,
			maxEmptyPolls: 1,
			onBatch: (_events, _envelope, ctx) => {
				heights.push(ctx.height);
				return ctx.cursor;
			},
			onReorg: () => {},
		});

		// 9 before the fork; after it, everything at or above 5 is gone, so the
		// highest block still known-canonical is 4.
		expect(heights).toEqual([9, 4]);
	});

	test("reports an unknown height before the first row arrives", async () => {
		const client = clientFor(() => ({
			events: [],
			next_cursor: null,
			tip: TIP,
			reorgs: [],
		}));

		const seen: Array<{ height: number | null; behind: number | null }> = [];
		await client.events.consume({
			eventType: "ft_transfer",
			emptyBackoffMs: 0,
			maxEmptyPolls: 1,
			onBatch: (_events, _envelope, ctx) => {
				seen.push({ height: ctx.height, behind: ctx.blocksBehind });
			},
		});

		// `height` stays null — no row was ever delivered, and "not started"
		// and "at genesis" are different states. `blocksBehind` is 0: the
		// empty page verified nothing matches up to the tip, so the sweep has
		// no backlog even though it has delivered nothing.
		expect(seen).toEqual([{ height: null, behind: 0 }]);
	});

	test("exposes the tip height on every batch", async () => {
		const client = clientFor(() => ({
			events: [event("2:0", 0, 2)],
			next_cursor: "2:0",
			tip: TIP,
			reorgs: [],
		}));

		let tipHeight = 0;
		await client.events.consume({
			eventType: "ft_transfer",
			maxPages: 1,
			onBatch: (_events, _envelope, ctx) => {
				tipHeight = ctx.tipHeight;
				return ctx.cursor;
			},
		});

		expect(tipHeight).toBe(TIP.block_height);
	});
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// ── Page-fetch retry ─────────────────────────────────────────────────

describe("consume page-fetch retry", () => {
	const okEnvelope = {
		events: [event("1:0", 0)],
		next_cursor: "1:0",
		tip: TIP,
		reorgs: [],
	};

	/** Fetch that fails `failures` times with `status`, then serves the feed. */
	function flakyClient(
		failures: number,
		status: number,
		headers: Record<string, string> = {},
	) {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			if (calls <= failures) {
				return new Response(JSON.stringify({ error: "err" }), {
					status,
					headers,
				});
			}
			return jsonResponse(okEnvelope);
		}) as unknown as typeof fetch;
		return { count: () => calls, client: new Index() };
	}

	test("survives a transient 429, honoring Retry-After for the delay", async () => {
		const { client, count } = flakyClient(1, 429, { "Retry-After": "7" });
		const sleeps: number[] = [];
		const applied: string[] = [];

		await client.events.consume({
			eventType: "ft_transfer",
			fromCursor: null,
			maxPages: 1,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			onBatch: (events) => {
				applied.push(...events.map((e) => e.cursor));
			},
		});

		expect(count()).toBe(2); // failed once, retried once
		expect(applied).toEqual(["1:0"]);
		expect(sleeps).toContain(7000); // Retry-After seconds, not the base delay
	});

	test("survives a transient 502 with the linear backoff", async () => {
		const { client, count } = flakyClient(2, 502);
		const sleeps: number[] = [];
		const observed: Array<{ attempt: number; retriesLeft: number }> = [];

		const result = await client.events.consume({
			eventType: "ft_transfer",
			fromCursor: null,
			maxPages: 1,
			retryDelay: 10,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			onError: (_err, ctx) => {
				observed.push({ attempt: ctx.attempt, retriesLeft: ctx.retriesLeft });
			},
			onBatch: () => undefined,
		});

		expect(count()).toBe(3);
		expect(result.cursor).toBe("1:0");
		expect(sleeps).toEqual([10, 20]); // retryDelay * (attempt + 1)
		expect(observed).toEqual([
			{ attempt: 0, retriesLeft: 3 },
			{ attempt: 1, retriesLeft: 2 },
		]);
	});

	test("rethrows a 400 immediately — caller bugs are not retried", async () => {
		const { client, count } = flakyClient(99, 400);
		await expect(
			client.events.consume({
				eventType: "ft_transfer",
				fromCursor: null,
				maxPages: 1,
				onBatch: () => undefined,
			}),
		).rejects.toThrow();
		expect(count()).toBe(1);
	});

	test("exhausts retryCount then rethrows the last failure", async () => {
		const { client, count } = flakyClient(99, 503);
		await expect(
			client.events.consume({
				eventType: "ft_transfer",
				fromCursor: null,
				maxPages: 1,
				retryCount: 2,
				retryDelay: 1,
				sleep: async () => {},
				onBatch: () => undefined,
			}),
		).rejects.toThrow();
		expect(count()).toBe(3); // 1 try + 2 retries
	});

	test("onBatch throws are never retried", async () => {
		const { client, count } = flakyClient(0, 200);
		await expect(
			client.events.consume({
				eventType: "ft_transfer",
				fromCursor: null,
				maxPages: 3,
				onBatch: () => {
					throw new Error("handler bug");
				},
			}),
		).rejects.toThrow("handler bug");
		expect(count()).toBe(1); // the failing page was fetched exactly once
	});

	test("onReorg throws are never retried — rollback must not be skipped", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			return jsonResponse({
				events: [],
				next_cursor: null,
				tip: TIP,
				reorgs: [reorg()],
			});
		}) as unknown as typeof fetch;

		await expect(
			new Index().events.consume({
				eventType: "ft_transfer",
				fromCursor: "6:0",
				maxPages: 3,
				onBatch: () => undefined,
				onReorg: () => {
					throw new Error("rollback failed");
				},
			}),
		).rejects.toThrow("rollback failed");
		expect(calls).toBe(1);
	});
});

describe("index sink capabilities", () => {
	test("a finalizedOnly sink following the tip throws before any fetch", async () => {
		let fetched = 0;
		const client = clientFor(() => {
			fetched++;
			return { events: [], next_cursor: null, tip: TIP, reorgs: [] };
		});

		await expect(
			client.events.consume({
				eventType: "ft_transfer",
				sink: {
					capabilities: { finalizedOnly: true },
					async loadCursor() {
						return null;
					},
					async commitBatch() {},
					async rollback() {},
				},
				maxPages: 1,
				onBatch: () => {},
			}),
		).rejects.toThrow(/finalizedOnly/);
		expect(fetched).toBe(0);
	});
});

describe("index resume position reporting", () => {
	test("a sink resume into a quiet tail reports the committed position, not nulls", async () => {
		const client = clientFor(() => ({
			events: [],
			next_cursor: null,
			tip: TIP,
			reorgs: [],
		}));

		const seen: Array<{
			cursor: string | null;
			height: number | null;
			scannedHeight: number | null;
			blocksBehind: number | null;
		}> = [];
		await client.events.consume({
			eventType: "ft_transfer",
			sink: {
				async loadCursor() {
					return "7:0";
				},
				async commitBatch(_cursor, write) {
					await write({} as never);
				},
				async rollback() {},
			},
			maxEmptyPolls: 1,
			emptyBackoffMs: 0,
			onProgress: (ctx) =>
				seen.push({
					cursor: ctx.cursor,
					height: ctx.height,
					scannedHeight: ctx.scannedHeight,
					blocksBehind: ctx.blocksBehind,
				}),
			onBatch: () => {},
		});

		// Empty page at the tail: last delivered stays 7, verified position is
		// the tip, backlog is zero.
		expect(seen).toEqual([
			{
				cursor: "7:0",
				height: 7,
				scannedHeight: TIP.block_height,
				blocksBehind: 0,
			},
		]);
	});
});

describe("index scanned position boundaries", () => {
	test("finalizedOnly claims only the finalized height on an empty page", async () => {
		// Rows exist above the finalized boundary but are filtered; the loop
		// deliberately re-reads them later, so "verified" stops at the boundary.
		const client = clientFor(() => ({
			events: [event("9:0", 0, 9)],
			next_cursor: "9:0",
			tip: TIP,
			reorgs: [],
		}));

		const seen: Array<{ scanned: number | null; behind: number | null }> = [];
		await client.events.consume({
			eventType: "ft_transfer",
			fromCursor: "8:0",
			finalizedOnly: true,
			maxEmptyPolls: 1,
			emptyBackoffMs: 0,
			onProgress: (ctx) =>
				seen.push({ scanned: ctx.scannedHeight, behind: ctx.blocksBehind }),
			onBatch: () => {},
		});

		// The row at 9 is above finalized_height (7) and was filtered out —
		// verified position is the finalized boundary, not the tip.
		expect(seen).toEqual([
			{
				scanned: TIP.finalized_height,
				behind: TIP.block_height - TIP.finalized_height,
			},
		]);
	});
});
