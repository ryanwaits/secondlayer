import { describe, expect, test } from "bun:test";
import subgraphsRouter from "../subgraphs.ts";

/**
 * Reindex drops the subgraph's schema unconditionally, so the walk range is
 * also the only data that survives it. A ranged reindex therefore never
 * "reindexes a range" — it rebuilds the range and permanently discards
 * everything outside it, while the subgraph goes right back to reporting
 * `active` at chain tip (f079: `--from-block N --to-block N` emptied the
 * public sbtc-flows subgraph, and the obvious recovery re-ran only
 * [N, tip], leaving 21% of its history).
 *
 * The route must therefore refuse a range outright and name the tool that
 * legitimately takes one, rather than accepting-and-ignoring it. The guard
 * runs before the subgraph is resolved (it is a request-shape rule, identical
 * for every subgraph), which is also what keeps this test free of a DB.
 */
const RANGE_REJECTED_MESSAGE =
	"Ranged reindex is not supported — reindex always drops and rebuilds the whole subgraph. Use `backfill` to process a specific block range.";

async function postReindex(body: unknown) {
	return subgraphsRouter.request("/any-subgraph/reindex", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("POST /:subgraphName/reindex refuses a block range", () => {
	test("fromBlock alone is rejected with the backfill alternative", async () => {
		const res = await postReindex({ fromBlock: 8255739 });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: RANGE_REJECTED_MESSAGE,
			code: "REINDEX_RANGE_NOT_SUPPORTED",
		});
	});

	test("toBlock alone is rejected", async () => {
		const res = await postReindex({ toBlock: 8255739 });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("REINDEX_RANGE_NOT_SUPPORTED");
	});

	test("the incident's exact call — a single-block range — is rejected", async () => {
		const res = await postReindex({ fromBlock: 8255739, toBlock: 8255739 });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("backfill");
	});

	test("a non-numeric range is rejected too, not silently ignored", async () => {
		// The pre-fix route only read `typeof body.fromBlock === "number"`, so a
		// string range fell through as "no range supplied". Presence is what
		// matters: the caller asked for something reindex cannot do.
		const res = await postReindex({ fromBlock: "8255739" });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("REINDEX_RANGE_NOT_SUPPORTED");
	});

	test("an unranged request is not rejected by this guard", async () => {
		// No range → the request proceeds past the guard to subgraph resolution,
		// which fails for this made-up name. Anything other than 400/
		// REINDEX_RANGE_NOT_SUPPORTED proves the guard let it through.
		const res = await postReindex({});
		if (res.status === 400) {
			const body = (await res.json()) as { code?: string };
			expect(body.code).not.toBe("REINDEX_RANGE_NOT_SUPPORTED");
		}
	});
});
