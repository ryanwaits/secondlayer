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
			consume: async (params) => {
				onTypes(params.types);
				return { cursor: null, pages: 0, emptyPolls: 0 };
			},
			stream: async function* () {},
		},
		tip: async () => tip(),
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

	test("NFT decoder tails the full stream by default to advance through sparse ranges", async () => {
		let seenTypes: readonly StreamsEventType[] | undefined;

		await consumeNftTransferDecodedEvents({
			streamsClient: streamsClientSpy((types) => {
				seenTypes = types;
			}),
			fromCursor: "1:0",
			maxPages: 1,
		});

		expect(seenTypes).toBeUndefined();
	});
});

function tip() {
	return {
		block_height: 1,
		index_block_hash: "0x01",
		burn_block_height: 1,
		lag_seconds: 0,
	};
}
