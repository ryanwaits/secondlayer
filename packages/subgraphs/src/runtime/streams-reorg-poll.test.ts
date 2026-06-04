import { describe, expect, test } from "bun:test";
import type { StreamsReorgRow } from "@secondlayer/shared/index-http";
import { pollReorgsOnce } from "./streams-reorg-poll.ts";

function reorg(fork: number): StreamsReorgRow {
	return {
		detected_at: `2026-01-0${fork}T00:00:00Z`,
		fork_point_height: fork,
		orphaned_range: { from: `${fork}:0`, to: `${fork + 1}:0` },
		new_canonical_tip: `${fork + 2}:0`,
	};
}

describe("pollReorgsOnce", () => {
	test("rewinds at each fork (lowest first) and advances the cursor", async () => {
		const http = {
			listReorgs: async () => ({
				reorgs: [reorg(900), reorg(500)],
				next_since: "2026-02-01T00:00:00Z",
			}),
		};
		const seen: number[] = [];
		const next = await pollReorgsOnce(
			http,
			"start",
			async (h) => {
				seen.push(h);
			},
			async () => ({}) as never,
		);
		expect(seen).toEqual([500, 900]); // lowest fork applied first
		expect(next).toBe("2026-02-01T00:00:00Z");
	});

	test("invokes the chain-reorg hook at each fork (lowest first)", async () => {
		const http = {
			listReorgs: async () => ({
				reorgs: [reorg(900), reorg(500)],
				next_since: "2026-02-01T00:00:00Z",
			}),
		};
		const chainForks: number[] = [];
		await pollReorgsOnce(
			http,
			"start",
			async () => {},
			async () => ({}) as never,
			async (h) => {
				chainForks.push(h);
			},
		);
		expect(chainForks).toEqual([500, 900]);
	});

	test("keeps the cursor when there are no reorgs / no next_since", async () => {
		const http = {
			listReorgs: async () => ({ reorgs: [], next_since: null }),
		};
		const next = await pollReorgsOnce(
			http,
			"cursor-x",
			async () => {},
			async () => ({}) as never,
		);
		expect(next).toBe("cursor-x");
	});
});
