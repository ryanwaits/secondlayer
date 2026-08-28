import { describe, expect, test } from "bun:test";
import type { StreamsClient } from "@secondlayer/sdk";
import type {
	StreamsEvent,
	StreamsEventType,
} from "@secondlayer/shared/streams-rows";
import {
	consumeFtBurnDecodedEvents,
	consumeFtMintDecodedEvents,
	consumeFtTransferDecodedEvents,
	consumeNftBurnDecodedEvents,
	consumeNftMintDecodedEvents,
	consumeNftTransferDecodedEvents,
	consumePrintDecodedEvents,
	consumeStxBurnDecodedEvents,
	consumeStxLockDecodedEvents,
	consumeStxMintDecodedEvents,
	consumeStxTransferDecodedEvents,
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
			subscribe: () => Object.assign(() => {}, { done: Promise.resolve() }),
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
				// Mirror what the real loop hands onBatch, progress fields included.
				const chainTip = tip();
				const height = events.at(-1)?.block_height ?? null;
				// The spy always feeds raw events with no sink attached; the
				// generic conditional param types (decoded/D, sink/TTx) can't see
				// that from inside the mock, hence the casts.
				await params.onBatch?.(
					events as Parameters<NonNullable<typeof params.onBatch>>[0],
					{ events, next_cursor: null, tip: chainTip, reorgs: [] },
					{
						cursor: null,
						height,
						tipHeight: chainTip.block_height,
						blocksBehind:
							height === null
								? null
								: Math.max(0, chainTip.block_height - height),
					} as Parameters<typeof params.onBatch>[2],
				);
				return { cursor: null, pages: 1, emptyPolls: 0 };
			},
		},
	};
}

const GENERIC_PRODUCERS: {
	type: StreamsEventType;
	run: typeof consumeFtTransferDecodedEvents;
}[] = [
	{ type: "ft_transfer", run: consumeFtTransferDecodedEvents },
	{ type: "nft_transfer", run: consumeNftTransferDecodedEvents },
	{ type: "stx_transfer", run: consumeStxTransferDecodedEvents },
	{ type: "stx_mint", run: consumeStxMintDecodedEvents },
	{ type: "stx_burn", run: consumeStxBurnDecodedEvents },
	{ type: "stx_lock", run: consumeStxLockDecodedEvents },
	{ type: "ft_mint", run: consumeFtMintDecodedEvents },
	{ type: "ft_burn", run: consumeFtBurnDecodedEvents },
	{ type: "nft_mint", run: consumeNftMintDecodedEvents },
	{ type: "nft_burn", run: consumeNftBurnDecodedEvents },
	{ type: "print", run: consumePrintDecodedEvents },
];

describe("L2 decoder Streams filters", () => {
	for (const producer of GENERIC_PRODUCERS) {
		test(`${producer.type} decoder requests only that Streams type`, async () => {
			let seenTypes: readonly StreamsEventType[] | undefined;
			await producer.run({
				streamsClient: streamsClientSpy((types) => {
					seenTypes = types;
				}),
				fromCursor: "1:0",
				maxPages: 1,
			});
			expect(seenTypes).toEqual([producer.type]);
		});
	}

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
			skipPersist: true,
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
