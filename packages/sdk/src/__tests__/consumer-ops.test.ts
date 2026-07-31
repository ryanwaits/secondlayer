import { describe, expect, test } from "bun:test";
import { consumerHealth } from "../consumer-ops.ts";

import type { ConsumerBatchContext } from "../streams/types.ts";

/** Fill the surface-specific fields a real loop always supplies. */
function ctx(
	partial: Omit<ConsumerBatchContext, "tip" | "reorgs">,
): ConsumerBatchContext {
	return { ...partial, tip: { block_height: partial.tipHeight }, reorgs: [] };
}

describe("consumerHealth", () => {
	test("healthy on cold start, healthy after a recent page, 503 when stale", () => {
		const health = consumerHealth({ staleAfterMs: 50 });
		const get = () => health.handler(new Request("http://x/health"));

		// Cold start: nothing to be stale about yet.
		expect(get().status).toBe(200);

		health.record(
			ctx({
				cursor: "5:0",
				height: 5,
				scannedHeight: 5,
				tipHeight: 10,
				blocksBehind: 5,
			}),
		);
		expect(get().status).toBe(200);
	});

	test("flips to 503 once pages stop landing", async () => {
		const health = consumerHealth({ staleAfterMs: 10 });
		health.record(
			ctx({
				cursor: "5:0",
				height: 5,
				scannedHeight: 5,
				tipHeight: 10,
				blocksBehind: 5,
			}),
		);
		await new Promise((r) => setTimeout(r, 25));
		const res = health.handler(new Request("http://x/health"));
		expect(res.status).toBe(503);
	});

	test("body reports progress; liveness is page-recency, not lag", async () => {
		const health = consumerHealth({ staleAfterMs: 60_000 });
		// A genesis backfill: millions behind, perfectly healthy.
		health.record(
			ctx({
				cursor: "1000:0",
				height: 1000,
				scannedHeight: 1000,
				tipHeight: 3_500_000,
				blocksBehind: 3_499_000,
			}),
		);
		const res = health.handler(new Request("http://x/health"));
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.blocks_behind).toBe(3_499_000);
		expect(body.checkpoint).toBe("1000:0");
	});

	test("non-/health paths 404", () => {
		const health = consumerHealth();
		expect(health.handler(new Request("http://x/nope")).status).toBe(404);
	});
});
