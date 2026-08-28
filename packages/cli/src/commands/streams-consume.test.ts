import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
	type StreamsEvent,
	type StreamsEventsEnvelope,
	createStreamsClient,
} from "@secondlayer/sdk";
import { consumeHandlers, parseMaxPages } from "./streams.ts";

/**
 * `streams consume` as a jsonl producer: what a reader tailing stdout sees
 * across a reorg, and how a bad page bound is refused instead of silently
 * streaming nothing.
 */

const CLI_ENTRY = join(import.meta.dir, "../cli.ts");

function event(height: number, index = 0): StreamsEvent {
	return {
		cursor: `${height}:${index}`,
		block_height: height,
		event_index: index,
	} as unknown as StreamsEvent;
}

function envelope(
	events: StreamsEvent[],
	next: string,
	tip: number,
	reorgs: StreamsEventsEnvelope["reorgs"] = [],
): StreamsEventsEnvelope {
	return {
		events,
		next_cursor: next,
		tip: { block_height: tip } as StreamsEventsEnvelope["tip"],
		reorgs,
	};
}

describe("streams consume output", () => {
	test("a page carrying a reorg prints a reorg line and the loop rewinds to the fork point", async () => {
		const reorg = {
			detected_at: "2026-08-27T00:00:00Z",
			fork_point_height: 150420,
			orphaned_range: { from: "150420:0", to: "150421:0" },
			new_canonical_tip: "150420:0",
		};
		const pages = [
			envelope([event(150420)], "150421:0", 150421),
			envelope([event(150422)], "150423:0", 150422, [reorg]),
			envelope([event(150420, 1)], "150421:0", 150422),
		];
		const requested: string[] = [];
		let served = 0;
		const client = createStreamsClient({
			baseUrl: "http://streams.test",
			apiKey: "k",
			fetchImpl: async (url) => {
				requested.push(new URL(String(url)).searchParams.get("cursor") ?? "");
				const page = pages[Math.min(served++, pages.length - 1)];
				return new Response(JSON.stringify(page), {
					headers: { "content-type": "application/json" },
				});
			},
		});
		const stdout: string[] = [];
		const stderr: string[] = [];
		const handlers = consumeHandlers({
			stdout: (l) => stdout.push(l),
			stderr: (l) => stderr.push(l),
		});
		const result = await client.events.consume({
			fromCursor: "150000:0",
			batchSize: 100,
			mode: "tail",
			maxPages: 3,
			onBatch: handlers.onBatch,
			onReorg: handlers.onReorg,
		});

		const kinds = stdout.map((line) => JSON.parse(line));
		expect(kinds.map((k) => k.kind ?? k.cursor)).toEqual([
			"150420:0",
			"reorg",
			"150420:1",
		]);
		expect(kinds[1]).toMatchObject({
			kind: "reorg",
			fork_point_height: 150420,
			orphaned_range: reorg.orphaned_range,
		});
		// Third fetch resumes from the foot of the fork, not past it.
		expect(requested[2]).toBe("150419:2147483647");
		expect(stderr).toEqual([
			"# next_cursor=150421:0",
			"# reorg at 150420; rewinding to 150419:2147483647",
			"# next_cursor=150421:0",
		]);
		expect(result.cursor).toBe("150421:0");
	});

	test("the checkpoint printed after a page is the loop's own cursor, so a handler never advances past what it received", () => {
		const stderr: string[] = [];
		const handlers = consumeHandlers({
			stdout: () => {},
			stderr: (l) => stderr.push(l),
		});
		const out = handlers.onBatch(
			[event(10)],
			envelope([event(10)], "99:0", 99),
			{
				cursor: "10:0",
				height: 10,
				scannedHeight: 10,
				tipHeight: 99,
				blocksBehind: 89,
				tip: { block_height: 99 },
				reorgs: [],
			},
		);
		expect(out).toBeUndefined();
		expect(stderr).toEqual(["# next_cursor=10:0"]);
	});
});

describe("streams consume --max-pages", () => {
	test("accepts a positive count and rejects anything that is not one", () => {
		expect(parseMaxPages("10")).toBe(10);
		expect(parseMaxPages(undefined)).toBeUndefined();
		for (const bad of ["abc", "0", "-1", "1.5", "10x", ""]) {
			expect(() => parseMaxPages(bad)).toThrow(
				"--max-pages must be a positive integer",
			);
		}
	});

	test("a non-numeric --max-pages exits 1 with the reason instead of streaming nothing and exiting 0", () => {
		const run = spawnSync(
			process.execPath,
			[CLI_ENTRY, "streams", "consume", "--max-pages", "abc"],
			{ encoding: "utf8", env: { ...process.env, INSTANCE_TOKEN: "x" } },
		);
		expect(run.status).toBe(1);
		expect(run.stderr).toContain("--max-pages must be a positive integer");
		expect(run.stdout).toBe("");
	});
});
