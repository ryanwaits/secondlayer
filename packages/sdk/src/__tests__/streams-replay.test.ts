import { describe, expect, test } from "bun:test";
import {
	type StreamsDumpFile,
	ValidationError,
	createStreamsClient,
} from "../index.ts";

const DUMPS_BASE = "https://dumps.secondlayer.test";

function dumpFile(
	from: number,
	to: number,
	maxCursor: string,
): StreamsDumpFile {
	return {
		path: `events/block_height/${from}-${to}/events.parquet`,
		from_block: from,
		to_block: to,
		min_cursor: `${from}:0`,
		max_cursor: maxCursor,
		row_count: 1,
		byte_size: 1,
		sha256: "x",
		schema_version: 1,
		created_at: "2026-05-29T00:00:00.000Z",
	};
}

const manifest = {
	dataset: "stacks-streams",
	network: "mainnet",
	version: "v0",
	schema_version: 1,
	generated_at: "2026-05-29T00:00:00.000Z",
	producer_version: "1.0.0",
	finality_lag_blocks: 6,
	latest_finalized_cursor: "19999:2",
	coverage: { from_block: 0, to_block: 19999 },
	// Intentionally out of order to prove replay sorts by block.
	files: [dumpFile(10000, 19999, "19999:2"), dumpFile(0, 9999, "9999:5")],
};

describe("events.replay", () => {
	test("iterates dumps in block order, then tails live from the seam", async () => {
		const liveCursors: (string | null)[] = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			dumpsBaseUrl: DUMPS_BASE,
			fetchImpl: (async (input: string | URL | Request) => {
				const url = String(input);
				if (url.endsWith("/manifest/latest.json")) {
					return new Response(JSON.stringify(manifest), { status: 200 });
				}
				// Live events request: capture the cursor, then return empty to stop.
				const cursor = new URL(url).searchParams.get("cursor");
				liveCursors.push(cursor);
				return new Response(
					JSON.stringify({
						events: [],
						next_cursor: null,
						tip: {
							block_height: 20000,
							block_hash: "0x01",
							burn_block_height: 30000,
							finalized_height: 19999,
							lag_seconds: 0,
						},
						reorgs: [],
					}),
					{ status: 200 },
				);
			}) as never,
		});

		const dumped: number[] = [];
		await client.events.replay({
			from: "genesis",
			mode: "bounded",
			onDumpFile: (file) => {
				dumped.push(file.from_block);
			},
			onBatch: () => undefined,
		});

		// Dumps processed in ascending block order.
		expect(dumped).toEqual([0, 10000]);
		// Live tail started at the manifest's latest_finalized_cursor (the seam).
		expect(liveCursors[0]).toBe("19999:2");
	});

	test("rejects a malformed `from` cursor instead of silently dropping dumps", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			dumpsBaseUrl: DUMPS_BASE,
			fetchImpl: (async () => {
				throw new Error("fetch should not run for an invalid cursor");
			}) as never,
		});

		await expect(
			client.events.replay({
				from: "abc",
				mode: "bounded",
				onDumpFile: () => undefined,
				onBatch: () => undefined,
			}),
		).rejects.toBeInstanceOf(ValidationError);
	});
});
