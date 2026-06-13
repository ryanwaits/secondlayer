import { afterEach, describe, expect, test } from "bun:test";
import type {
	ContractCallsEnvelope,
	EventsEnvelope,
	IndexContractCall,
	IndexEvent,
	IndexReorg,
	IndexTip,
} from "../index.ts";
import { Index } from "../index.ts";

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

	test("rolls back a reorg, rewinds the cursor, and dedups re-reported reorgs", async () => {
		const r = reorg({ fork_point_height: 5 });
		const byCursor: Record<string, EventsEnvelope> = {
			null: {
				events: [event("6:0", 0, 6)],
				next_cursor: "6:0",
				tip: TIP,
				reorgs: [r],
			},
			"5:0": {
				events: [event("6:0", 0, 6), event("7:0", 1, 7)],
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

		const rollbacks: Array<{ fork: number; cursor: string }> = [];
		const applied: string[] = [];
		const result = await client.events.consume({
			eventType: "ft_transfer",
			fromCursor: null,
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
		expect(requested.cursors).toEqual([null, "5:0", "7:0"]);
		expect(result.cursor).toBe("7:0");
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
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
