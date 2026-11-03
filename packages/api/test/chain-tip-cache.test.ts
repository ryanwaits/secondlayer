import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { getChainTip, resetChainTipCache } from "../src/routes/subgraphs.ts";

/**
 * getChainTip() TTL cache: per-request `index_progress` reads on the hot
 * subgraph read plane are pointless (the tip only advances at chain speed),
 * so a short in-process cache absorbs repeat calls within its window.
 */

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("getChainTip cache", () => {
	const NETWORK = `chain-tip-cache-test-${crypto.randomUUID().slice(0, 8)}`;
	let prevNetwork: string | undefined;

	beforeEach(() => {
		prevNetwork = process.env.NETWORK;
		process.env.NETWORK = NETWORK;
		resetChainTipCache();
	});

	afterAll(async () => {
		if (prevNetwork === undefined) delete process.env.NETWORK;
		else process.env.NETWORK = prevNetwork;
		await getDb()
			.deleteFrom("index_progress")
			.where("network", "like", "chain-tip-cache-test-%")
			.execute();
	});

	// `highest_seen_block` is a bigint column — the driver returns it as a
	// string at runtime (a pre-existing quirk of getChainTip, not something
	// this cache changes); normalize for these assertions.
	async function tip(now: number): Promise<number> {
		return Number(await getChainTip(now));
	}

	async function seedTip(highestSeenBlock: number): Promise<void> {
		await getDb()
			.insertInto("index_progress")
			.values({
				network: NETWORK,
				last_indexed_block: highestSeenBlock,
				last_contiguous_block: highestSeenBlock,
				highest_seen_block: highestSeenBlock,
			})
			.onConflict((oc) =>
				oc.column("network").doUpdateSet({
					last_indexed_block: highestSeenBlock,
					last_contiguous_block: highestSeenBlock,
					highest_seen_block: highestSeenBlock,
				}),
			)
			.execute();
	}

	test("repeat calls within the TTL window return the cached value; the window expiring triggers a re-read", async () => {
		await seedTip(100);
		const t0 = Date.now();

		expect(await tip(t0)).toBe(100);

		// Mutate the row after the first read — a call still inside the TTL
		// must not observe this, proving it didn't re-query.
		await seedTip(200);
		expect(await tip(t0 + 1999)).toBe(100);

		// Past the 2s TTL — re-reads and picks up the mutated value.
		expect(await tip(t0 + 2001)).toBe(200);
	});

	test("resetChainTipCache forces a re-read even within the TTL window", async () => {
		await seedTip(300);
		const t0 = Date.now();
		expect(await tip(t0)).toBe(300);

		await seedTip(400);
		expect(await tip(t0 + 1)).toBe(300); // still cached

		resetChainTipCache();
		expect(await tip(t0 + 1)).toBe(400); // forced re-read
	});

	test("a transient no-row read after the TTL expires returns the stale previous value, not 0", async () => {
		await seedTip(500);
		const t0 = Date.now();
		expect(await tip(t0)).toBe(500);

		// Simulate the row disappearing (blip) by pointing at a network with
		// no index_progress row, past the TTL.
		process.env.NETWORK = `${NETWORK}-missing`;
		expect(await tip(t0 + 2001)).toBe(500);
	});

	describe("tenant without a local indexer", () => {
		let server: ReturnType<typeof Bun.serve>;
		let requests = 0;
		let respond: () => Response;
		const savedUrl = process.env.SUBGRAPH_INDEX_API_URL;

		beforeEach(() => {
			requests = 0;
			// No index_progress row for this network: the tenant shape.
			process.env.NETWORK = `${NETWORK}-tenant`;
			respond = () => Response.json({ block_height: 777 });
			server = Bun.serve({
				port: 0,
				fetch: () => {
					requests++;
					return respond();
				},
			});
			process.env.SUBGRAPH_INDEX_API_URL = `http://127.0.0.1:${server.port}`;
		});

		afterEach(async () => {
			await server.stop(true);
			if (savedUrl === undefined) {
				process.env.SUBGRAPH_INDEX_API_URL = "";
			} else {
				process.env.SUBGRAPH_INDEX_API_URL = savedUrl;
			}
		});

		test("reads the platform tip, and one fetch serves the whole TTL window", async () => {
			const t0 = Date.now();
			expect(await tip(t0)).toBe(777);
			expect(await tip(t0 + 1999)).toBe(777);
			expect(requests).toBe(1);

			expect(await tip(t0 + 2001)).toBe(777);
			expect(requests).toBe(2);
		});

		test("an unreachable platform keeps the last tip and retries once per window, not per call", async () => {
			const t0 = Date.now();
			expect(await tip(t0)).toBe(777);

			respond = () => new Response("down", { status: 500 });
			expect(await tip(t0 + 2001)).toBe(777);
			const afterFailure = requests;
			expect(await tip(t0 + 2002)).toBe(777);
			expect(await tip(t0 + 3000)).toBe(777);
			expect(requests).toBe(afterFailure);
		});
	});
});
