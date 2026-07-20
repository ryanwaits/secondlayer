import { describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import {
	encodeReorgsNextSince,
	getStreamsReorgsListResponse,
	parseReorgsSince,
} from "./reorgs.ts";

const UUID = "1a20beed-9764-401e-be1a-7e6c59a4cf7b";

const RECORD = {
	id: UUID,
	detected_at: "2026-07-19T04:47:25.514205Z",
	fork_point_height: 8588932,
	old_index_block_hash: null,
	new_index_block_hash: null,
	orphaned_range: { from: "8588932:0", to: "8588932:0" },
	new_canonical_tip: "8588932:0",
};

describe("parseReorgsSince", () => {
	test("a streams block cursor decodes to a block-height cursor", () => {
		expect(parseReorgsSince("8588932:4")).toEqual({
			block_height: 8588932,
			event_index: 4,
		});
	});

	test("a plain ISO timestamp becomes a time cursor without an id tiebreak", () => {
		expect(parseReorgsSince("2026-07-19T04:47:25.514Z")).toEqual({
			detected_at: "2026-07-19T04:47:25.514Z",
			id: null,
		});
	});

	test("a microsecond timestamp survives verbatim — never rounded through a JS Date", () => {
		expect(parseReorgsSince("2026-07-19T04:47:25.514205Z")).toEqual({
			detected_at: "2026-07-19T04:47:25.514205Z",
			id: null,
		});
	});

	test("a composite next_since round-trips into a time cursor with the id tiebreak", () => {
		const cursor = encodeReorgsNextSince(RECORD);
		expect(cursor).toBe(`2026-07-19T04:47:25.514205Z~${UUID}`);
		expect(parseReorgsSince(cursor)).toEqual({
			detected_at: "2026-07-19T04:47:25.514205Z",
			id: UUID,
		});
	});

	test("rejects a composite cursor whose id is not a UUID", () => {
		expect(() =>
			parseReorgsSince("2026-07-19T04:47:25.514205Z~not-a-uuid"),
		).toThrow(ValidationError);
	});

	test("rejects garbage and empty since values", () => {
		expect(() => parseReorgsSince("not-a-date")).toThrow(ValidationError);
		expect(() => parseReorgsSince(null)).toThrow(ValidationError);
	});
});

describe("getStreamsReorgsListResponse", () => {
	test("next_since carries the last reorg's exact detected_at plus its id", async () => {
		const response = await getStreamsReorgsListResponse({
			query: new URLSearchParams({ since: "2026-07-19T00:00:00Z" }),
			readReorgsSince: async () => [RECORD],
		});
		expect(response.next_since).toBe(`2026-07-19T04:47:25.514205Z~${UUID}`);
	});

	test("next_since is null when no reorgs are returned", async () => {
		const response = await getStreamsReorgsListResponse({
			query: new URLSearchParams({ since: "2026-07-19T00:00:00Z" }),
			readReorgsSince: async () => [],
		});
		expect(response.next_since).toBeNull();
	});
});
