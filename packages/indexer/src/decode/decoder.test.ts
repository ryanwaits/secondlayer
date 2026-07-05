import { describe, expect, test } from "bun:test";
import type {
	StreamsClient,
	StreamsEvent,
	StreamsEventType,
} from "@secondlayer/sdk";
import {
	consumeFtTransferDecodedEvents,
	consumeNftTransferDecodedEvents,
} from "./decoder.ts";

function streamsClientSpy(
	onTypes: (types: readonly StreamsEventType[] | undefined) => void,
): StreamsClient {
	return {
		// Top-level batch iterator (unused by the decoder; present for the type).
		consume: async function* () {},
		events: {
			list: async () => ({
				events: [],
				next_cursor: null,
				tip: tip(),
				reorgs: [],
			}),
			byTxId: async () => ({
				events: [],
				tip: tip(),
				reorgs: [],
			}),
			consume: async (params) => {
				onTypes(params.types);
				return { cursor: null, pages: 0, emptyPolls: 0 };
			},
			replay: async () => ({ cursor: null, pages: 0, emptyPolls: 0 }),
			stream: async function* () {},
			subscribe: () => () => {},
		},
		blocks: {
			events: async () => ({
				events: [],
				tip: tip(),
				reorgs: [],
			}),
		},
		reorgs: {
			list: async () => ({ reorgs: [], next_since: null }),
		},
		dumps: {
			list: async () => {
				throw new Error("not used");
			},
			fileUrl: () => "",
			download: async () => new Uint8Array(),
		},
		canonical: async (height) => ({
			block_height: height,
			block_hash: "0x01",
			burn_block_height: 1,
			burn_block_hash: null,
			is_canonical: true,
		}),
		tip: async () => tip(),
		usage: async () => ({
			product: "streams",
			tier: "build",
			limits: { rate_limit_per_second: 50, retention_days: 30 },
			usage: { events_today: 0, events_this_month: 0 },
		}),
	};
}

// Extends streamsClientSpy so `events.consume` actually invokes the
// decoder's onBatch with a caller-supplied batch, instead of the base
// spy's no-op. Used to exercise the FT onBatch's per-event error handling.
function streamsClientOnBatchSpy(events: StreamsEvent[]): StreamsClient {
	const base = streamsClientSpy(() => {});
	return {
		...base,
		events: {
			...base.events,
			consume: async (params) => {
				await params.onBatch(
					events,
					{ events, next_cursor: null, tip: tip(), reorgs: [] },
					{ cursor: null },
				);
				return { cursor: null, pages: 1, emptyPolls: 0 };
			},
		},
	};
}

describe("L2 decoder Streams filters", () => {
	test("FT decoder requests only ft_transfer Streams events by default", async () => {
		let seenTypes: readonly StreamsEventType[] | undefined;

		await consumeFtTransferDecodedEvents({
			streamsClient: streamsClientSpy((types) => {
				seenTypes = types;
			}),
			fromCursor: "1:0",
			maxPages: 1,
		});

		expect(seenTypes).toEqual(["ft_transfer"]);
	});

	test("NFT decoder requests only nft_transfer Streams events by default", async () => {
		let seenTypes: readonly StreamsEventType[] | undefined;

		await consumeNftTransferDecodedEvents({
			streamsClient: streamsClientSpy((types) => {
				seenTypes = types;
			}),
			fromCursor: "1:0",
			maxPages: 1,
		});

		expect(seenTypes).toEqual(["nft_transfer"]);
	});

	test("FT decoder skips a poison event instead of throwing", async () => {
		const poison = {
			cursor: "1:0",
			block_height: 1,
			block_hash: "0x01",
			burn_block_height: 1,
			tx_id: "0xdead",
			tx_index: 0,
			event_index: 0,
			event_type: "ft_transfer",
			contract_id: null,
			ts: "2026-07-04T00:00:00.000Z",
			// Missing asset_identifier/sender/recipient/amount → decodeFtTransfer throws.
			payload: {},
		} as unknown as StreamsEvent;

		const result = await consumeFtTransferDecodedEvents({
			streamsClient: streamsClientOnBatchSpy([poison]),
			fromCursor: "1:0",
			maxPages: 1,
		});

		expect(result.decoded).toBe(0);
	});
});

function tip() {
	return {
		block_height: 1,
		block_hash: "0x01",
		burn_block_height: 1,
		lag_seconds: 0,
	};
}
