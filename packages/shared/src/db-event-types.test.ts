import { describe, expect, test } from "bun:test";
import {
	STREAMS_CURSOR_VERSION,
	STREAMS_DB_EVENT_TYPES,
} from "./db-event-types.ts";

/**
 * The event type list per cursor version. Streams cursors encode an ordinal
 * over these types, so a list that changes under a version would shift saved
 * cursors. To change the list: bump `STREAMS_CURSOR_VERSION`, add the new
 * version here, and keep every earlier entry untouched.
 */
const PINNED_TYPES_BY_VERSION: Record<number, readonly string[]> = {
	1: [
		"stx_transfer_event",
		"stx_mint_event",
		"stx_burn_event",
		"stx_lock_event",
		"ft_transfer_event",
		"ft_mint_event",
		"ft_burn_event",
		"nft_transfer_event",
		"nft_mint_event",
		"nft_burn_event",
		"smart_contract_event",
		"contract_event",
	],
};

describe("streams cursor ordinal contract", () => {
	test("the event type list matches the list pinned for the current cursor version", () => {
		expect(PINNED_TYPES_BY_VERSION[STREAMS_CURSOR_VERSION]).toEqual([
			...STREAMS_DB_EVENT_TYPES,
		]);
	});
});
