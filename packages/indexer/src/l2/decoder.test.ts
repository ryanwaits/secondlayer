import { describe, expect, test } from "bun:test";
import type { StreamsClient, StreamsEventType } from "@secondlayer/sdk";
import {
	consumeFtTransferDecodedEvents,
	consumeNftTransferDecodedEvents,
} from "./decoder.ts";

function streamsClientSpy(
	onTypes: (types: readonly StreamsEventType[] | undefined) => void,
): StreamsClient {
	return {
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
});

function tip() {
	return {
		block_height: 1,
		block_hash: "0x01",
		burn_block_height: 1,
		lag_seconds: 0,
	};
}
