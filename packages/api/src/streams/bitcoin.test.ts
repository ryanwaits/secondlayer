import { describe, expect, test } from "bun:test";
import {
	type StreamsBitcoinEventsReader,
	type StreamsBitcoinTip,
	getStreamsBitcoinEventsResponse,
	parseStreamsBitcoinEventsQuery,
} from "./bitcoin.ts";

const TIP: StreamsBitcoinTip = {
	block_height: 840_100,
	block_hash: "btchash840100",
	finalized_height: 840_094,
	lag_seconds: 0,
};

function params(query: string) {
	return new URL(`http://localhost/v1/streams/events${query}`).searchParams;
}

describe("parseStreamsBitcoinEventsQuery", () => {
	test("defaults to the last day (144 blocks) when no cursor/height given", () => {
		const parsed = parseStreamsBitcoinEventsQuery(params(""), TIP);
		expect(parsed.fromHeight).toBe(TIP.block_height - 144);
		expect(parsed.toHeight).toBe(TIP.block_height);
	});

	test("explicit from_height=0 bypasses the default window", () => {
		const parsed = parseStreamsBitcoinEventsQuery(
			params("?from_height=0"),
			TIP,
		);
		expect(parsed.fromHeight).toBe(0);
	});

	test("parses types into db kinds", () => {
		const parsed = parseStreamsBitcoinEventsQuery(
			params("?types=rune_etch,rune_transfer"),
			TIP,
		);
		expect(parsed.types).toEqual(["etch", "transfer"]);
	});

	test("rejects an unknown (Stacks) event type by name", () => {
		expect(() =>
			parseStreamsBitcoinEventsQuery(params("?types=ft_transfer"), TIP),
		).toThrow(/Unknown Streams event type for chain=bitcoin/);
	});

	test("rejects contract_id, sender, recipient, asset_identifier, filters, event_type", () => {
		for (const q of [
			"?contract_id=SP1.token",
			"?sender=SP1",
			"?recipient=SP1",
			"?asset_identifier=SP1.t::x",
			`?filters=${encodeURIComponent(JSON.stringify({ a: {} }))}`,
			"?event_type=print",
		]) {
			expect(() => parseStreamsBitcoinEventsQuery(params(q), TIP)).toThrow(
				/Stacks-only/,
			);
		}
	});

	test("rejects clock=vm", () => {
		expect(() =>
			parseStreamsBitcoinEventsQuery(params("?clock=vm"), TIP),
		).toThrow(/Stacks-only/);
	});

	test("parses a rune id ref", () => {
		const parsed = parseStreamsBitcoinEventsQuery(
			params("?rune=840000:3"),
			TIP,
		);
		expect(parsed.rune).toEqual({ id: "840000:3" });
	});

	test("parses an address filter", () => {
		const parsed = parseStreamsBitcoinEventsQuery(
			params("?address=bc1qtest"),
			TIP,
		);
		expect(parsed.address).toBe("bc1qtest");
	});

	test("cursor and from_height are mutually exclusive", () => {
		expect(() =>
			parseStreamsBitcoinEventsQuery(
				params("?cursor=840000:0&from_height=0"),
				TIP,
			),
		).toThrow(/mutually exclusive/);
	});

	test("cursor past the tip is flagged", () => {
		const parsed = parseStreamsBitcoinEventsQuery(
			params("?cursor=999999:0"),
			TIP,
		);
		expect(parsed.cursorPastTip).toBe(true);
	});
});

describe("getStreamsBitcoinEventsResponse", () => {
	test("marks events at or below the finality boundary as finalized", async () => {
		const event = (block_height: number, event_index: number) => ({
			cursor: `${block_height}:${event_index}`,
			chain: "bitcoin" as const,
			block_height,
			block_hash: "h",
			tx_id: "tx",
			tx_index: 0,
			event_index,
			event_type: "rune_mint" as const,
			rune_id: "840000:3",
			payload: { amount: "1" },
		});
		const readEvents: StreamsBitcoinEventsReader = async () => ({
			events: [event(840_090, 0), event(840_094, 0), event(840_095, 0)],
			next_cursor: null,
		});
		const body = await getStreamsBitcoinEventsResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readEvents,
		});
		expect(body.events.map((e) => e.finalized)).toEqual([true, true, false]);
	});

	test("cursor past the tip returns an empty page and echoes the cursor", async () => {
		const body = await getStreamsBitcoinEventsResponse({
			query: params("?cursor=999999:0"),
			tip: TIP,
			readEvents: async () => {
				throw new Error("should not read events");
			},
		});
		expect(body.events).toEqual([]);
		expect(body.next_cursor).toBe("999999:0");
	});

	test("forwards rune and address filters to the reader", async () => {
		let seen: Record<string, unknown> = {};
		await getStreamsBitcoinEventsResponse({
			query: params("?rune=840000:3&address=bc1qtest&from_height=0"),
			tip: TIP,
			readEvents: async (p) => {
				seen = p;
				return { events: [], next_cursor: null };
			},
		});
		expect(seen.rune).toEqual({ id: "840000:3" });
		expect(seen.address).toBe("bc1qtest");
	});

	test("attaches reorgs spanning the returned page", async () => {
		let seenRange: unknown;
		const body = await getStreamsBitcoinEventsResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readEvents: async () => ({
				events: [
					{
						cursor: "840090:0",
						chain: "bitcoin" as const,
						block_height: 840_090,
						block_hash: "h",
						tx_id: "tx",
						tx_index: 0,
						event_index: 0,
						event_type: "rune_burn" as const,
						rune_id: "840000:3",
						payload: { amount: "1" },
					},
				],
				next_cursor: "840090:0",
			}),
			readReorgs: async (range) => {
				seenRange = range;
				return [
					{
						id: "1",
						detected_at: "2026-09-25T00:00:00.000Z",
						fork_point_height: 840_090,
						old_index_block_hash: "0xold",
						new_index_block_hash: "0xnew",
						orphaned_range: { from: "840090:0", to: "840090:2147483647" },
						new_canonical_tip: "840091:0",
					},
				];
			},
		});
		expect(seenRange).toEqual({
			from: { block_height: 840_090, event_index: 0 },
			to: { block_height: 840_090, event_index: 0 },
		});
		expect(body.reorgs.map((r) => r.id)).toEqual(["1"]);
	});
});
