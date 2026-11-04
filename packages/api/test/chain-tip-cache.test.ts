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

const indexTip = (height: number) =>
	Response.json({ blocks: [], tip: { block_height: height } });

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
		let lastRequest: { url: string; authorization: string | null } | undefined;
		const savedUrl = process.env.SUBGRAPH_INDEX_API_URL;
		const savedKeys = {
			INDEX_INTERNAL_API_KEY: process.env.INDEX_INTERNAL_API_KEY,
			STREAMS_INTERNAL_API_KEY: process.env.STREAMS_INTERNAL_API_KEY,
			INSTANCE_TOKEN: process.env.INSTANCE_TOKEN,
		};

		beforeEach(() => {
			requests = 0;
			// No index_progress row for this network: the tenant shape.
			process.env.NETWORK = `${NETWORK}-tenant`;
			respond = () => indexTip(777);
			server = Bun.serve({
				port: 0,
				fetch: (req) => {
					lastRequest = {
						url: req.url,
						authorization: req.headers.get("authorization"),
					};
					requests++;
					return respond();
				},
			});
			process.env.SUBGRAPH_INDEX_API_URL = `http://127.0.0.1:${server.port}`;
		});

		afterEach(async () => {
			await server.stop(true);
			for (const [name, value] of Object.entries(savedKeys)) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
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

		test("a tenant api env (index key, no streams key) reads the Index tip with the index key", async () => {
			process.env.INDEX_INTERNAL_API_KEY = "tenant-read-key";
			delete process.env.STREAMS_INTERNAL_API_KEY;
			delete process.env.INSTANCE_TOKEN;
			respond = () => indexTip(9_407_910);

			expect(await tip(Date.now())).toBe(9_407_910);
			const url = new URL(lastRequest?.url ?? "http://missing");
			expect(url.pathname).toBe("/v1/index/blocks");
			expect(url.searchParams.get("tip_only")).toBe("true");
			expect(lastRequest?.authorization).toBe("Bearer tenant-read-key");
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

		test("a platform that never answers costs at most the timeout and keeps the last tip", async () => {
			const t0 = Date.now();
			expect(await tip(t0)).toBe(777);

			respond = () => new Promise<Response>(() => {}) as unknown as Response;
			const started = performance.now();
			expect(await tip(t0 + 2001)).toBe(777);
			expect(performance.now() - started).toBeLessThan(600);
		});

		test("a platform that never answers reads 0 when no tip was cached", async () => {
			respond = () => new Promise<Response>(() => {}) as unknown as Response;
			const started = performance.now();
			expect(await tip(Date.now())).toBe(0);
			expect(performance.now() - started).toBeLessThan(600);
		});
	});
});
