import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import type { IndexHttpClient } from "@secondlayer/shared/index-http";
import { sql } from "kysely";
import { handleChainReorg } from "./chain-reorg.ts";
import {
	MIN_REAL_WAIT_MS,
	advanceCursor,
	classifyWaitOutcome,
	delayAfterTick,
	getChainReorgGeneration,
	nextTickDelayMs,
	runEvaluatorOnce,
	shouldWaitThisTick,
	wasRealWait,
} from "./trigger-evaluator-loop.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const db = getDb();

async function setCursor(height: number): Promise<void> {
	await db
		.updateTable("trigger_evaluator_state")
		.set({ last_processed_block: height })
		.where("id", "=", true)
		.execute();
}

async function cursor(): Promise<number> {
	const row = await db
		.selectFrom("trigger_evaluator_state")
		.select("last_processed_block")
		.where("id", "=", true)
		.executeTakeFirstOrThrow();
	return Number(row.last_processed_block);
}

describe("chain-evaluator cursor advance vs. reorg rewind", () => {
	beforeEach(async () => {
		await setCursor(0);
	});

	it("a stale advance snapshotted before a reorg cannot overwrite the rewind", async () => {
		await setCursor(300);
		// chainReorgGeneration is a module global that accumulates across tests —
		// snapshot it fresh here rather than assuming it starts at 0.
		const gen0 = getChainReorgGeneration();

		// A reorg lands, bumping the generation and rewinding the cursor.
		await handleChainReorg(150, db);
		expect(await cursor()).toBe(149);

		// The evaluator's in-flight tick, snapshotted before the reorg, tries to
		// advance to its stale target using the old generation.
		const result = await advanceCursor(db, 300, gen0);

		expect(result).toEqual({ advanced: false, reorged: true });
		expect(await cursor()).toBe(149);
	});

	it("an advance at the current generation still moves the cursor forward", async () => {
		await setCursor(149);
		const gen = getChainReorgGeneration();

		const result = await advanceCursor(db, 300, gen);

		expect(result).toEqual({ advanced: true, reorged: false });
		expect(await cursor()).toBe(300);
	});

	it("an advance never moves the cursor backward", async () => {
		await setCursor(300);
		const gen = getChainReorgGeneration();

		const result = await advanceCursor(db, 200, gen);

		expect(result).toEqual({ advanced: false, reorged: false });
		expect(await cursor()).toBe(300);
	});
});

describe("nextTickDelayMs", () => {
	it("re-arms immediately (0ms) when the tick advanced the cursor — a backlog drains without idle gaps", () => {
		expect(nextTickDelayMs(true, 5_000)).toBe(0);
	});

	it("falls back to the poll interval when the tick made no progress", () => {
		expect(nextTickDelayMs(false, 5_000)).toBe(5_000);
	});
});

describe("shouldWaitThisTick", () => {
	it("waits only when the previous tick was idle at the tip AND the server still supports wait", () => {
		expect(shouldWaitThisTick(true, true)).toBe(true);
	});

	it("never waits after a tick that found work to do — waiting would delay real progress", () => {
		expect(shouldWaitThisTick(false, true)).toBe(false);
	});

	it("never waits once the server has been found not to support it, even if idle", () => {
		expect(shouldWaitThisTick(true, false)).toBe(false);
	});
});

describe("delayAfterTick", () => {
	it("re-arms immediately after a tick that long-polled — it already spent its wait inside the call", () => {
		expect(delayAfterTick(true, false, 5_000)).toBe(0);
		expect(delayAfterTick(true, true, 5_000)).toBe(0);
	});

	it("falls back to nextTickDelayMs's rule when the tick did not wait", () => {
		expect(delayAfterTick(false, true, 5_000)).toBe(0);
		expect(delayAfterTick(false, false, 5_000)).toBe(5_000);
	});
});

describe("wasRealWait (busy-loop regression guard)", () => {
	it("is false when this tick never asked the server to wait in the first place", () => {
		expect(wasRealWait(false, true, 20_000)).toBe(false);
	});

	it("is false when a wait was requested but the response came back fast reporting nothing new — a server that isn't actually holding wait", () => {
		expect(wasRealWait(true, true, 100)).toBe(false);
	});

	it("is true when a wait was requested and it genuinely held close to the full window", () => {
		expect(wasRealWait(true, true, MIN_REAL_WAIT_MS + 1)).toBe(true);
	});

	it("is true on an early return with new data, even if that took well under the floor — a legitimate wake, not broken wait", () => {
		expect(wasRealWait(true, false, 50)).toBe(true);
	});
});

describe("classifyWaitOutcome", () => {
	it("is not_requested when the tick never asked to wait", () => {
		expect(
			classifyWaitOutcome({
				waitRequested: false,
				waitSupported: true,
				knownHeight: 100,
				rawTip: 100,
			}),
		).toBe("not_requested");
	});

	it("is not_supported when the client has already given up on wait/tip_only for this server", () => {
		expect(
			classifyWaitOutcome({
				waitRequested: true,
				waitSupported: false,
				knownHeight: 100,
				rawTip: 100,
			}),
		).toBe("not_supported");
	});

	it("is tip_moved when the returned tip is past the baseline this tick sent", () => {
		expect(
			classifyWaitOutcome({
				waitRequested: true,
				waitSupported: true,
				knownHeight: 100,
				rawTip: 101,
			}),
		).toBe("tip_moved");
	});

	it("is timeout when a real wait held and reported nothing past the baseline", () => {
		expect(
			classifyWaitOutcome({
				waitRequested: true,
				waitSupported: true,
				knownHeight: 100,
				rawTip: 100,
			}),
		).toBe("timeout");
	});

	it("is timeout, not tip_moved, when there was no baseline to compare against", () => {
		expect(
			classifyWaitOutcome({
				waitRequested: true,
				waitSupported: true,
				knownHeight: undefined,
				rawTip: 100,
			}),
		).toBe("timeout");
	});
});

describe("plan-063 regression: a wait that never actually holds must not become a busy loop", () => {
	it("delayAfterTick, fed a non-real wait, falls back to the poll interval instead of re-arming at 0", () => {
		// This is the exact composition startTriggerEvaluator uses: gate
		// delayAfterTick's first argument on wasRealWait, not on `usedWait`
		// alone. A server that answers `wait` instantly while reporting no
		// progress must degrade to at most one request per POLL_MS, never a
		// tight loop.
		const usedWait = true;
		const idleAtTipAfter = true;
		const brokenElapsedMs = 90; // a real network hop, nowhere near a 20s wait
		const real = wasRealWait(usedWait, idleAtTipAfter, brokenElapsedMs);
		expect(delayAfterTick(real, false, 5_000)).toBe(5_000);
	});
});

describe("chain evaluator vs. a block the source does not return", () => {
	const FROM = 1000;
	const TIP = FROM + 4;
	const EVENT_HEIGHT = FROM + 3;
	const NAME_PREFIX = `missing-block-${randomUUID()}-`;
	const savedEnv = {
		SUBGRAPH_SOURCE: process.env.SUBGRAPH_SOURCE,
		SUBGRAPH_INDEX_API_URL: process.env.SUBGRAPH_INDEX_API_URL,
	};
	let webhookId: string;

	/** Fake hosted Index. `available(h, singleHeight)` decides whether a height
	 *  comes back from `walkBlocks`; `singleHeight` is true for the evaluator's
	 *  one-height refetch. One stx_transfer sits at EVENT_HEIGHT. */
	function fakeHttp(
		available: (height: number, singleHeight: boolean) => boolean,
	): IndexHttpClient {
		return {
			getIndexTip: async () => TIP,
			getIndexSourceTip: async () => TIP,
			// Remote decoder mode: the bound comes from here, not decoder_checkpoints.
			getDecodedHeights: () => ({ stx_transfer: TIP }),
			waitIsSupported: () => true,
			walkBlocks: async (from: number, to: number) => {
				const rows = [];
				for (let h = from; h <= to; h++) {
					if (!available(h, from === to)) continue;
					rows.push({
						block_height: h,
						block_hash: `0xh${h}`,
						parent_hash: `0xh${h - 1}`,
						burn_block_height: h,
						burn_block_hash: null,
						block_time: "2026-01-01T00:00:00.000Z",
					});
				}
				return rows;
			},
			walkTransactions: async () => [],
			walkEvents: async (_type: string, from: number, to: number) =>
				EVENT_HEIGHT >= from && EVENT_HEIGHT <= to
					? [
							{
								event_type: "stx_transfer",
								block_height: EVENT_HEIGHT,
								tx_id: "0xtx-missing-block",
								tx_index: 0,
								event_index: 0,
								contract_id: null,
								tx_sender: "SP1",
								tx_type: "token_transfer",
								tx_status: "success",
								sender: "SP1",
								recipient: "SP2",
								amount: "1000",
								memo: null,
							},
						]
					: [],
		} as unknown as IndexHttpClient;
	}

	async function outboxHeights(): Promise<number[]> {
		const rows = await db
			.selectFrom("webhook_outbox")
			.select("block_height")
			.where("webhook_id", "=", webhookId)
			.execute();
		return rows.map((r) => Number(r.block_height));
	}

	async function cleanup(): Promise<void> {
		await db
			.deleteFrom("webhook_outbox")
			.where("webhook_id", "in", (qb) =>
				qb
					.selectFrom("webhooks")
					.select("id")
					.where("name", "like", `${NAME_PREFIX}%`),
			)
			.execute();
		await db
			.deleteFrom("webhooks")
			.where("name", "like", `${NAME_PREFIX}%`)
			.execute();
		await setCursor(0);
	}

	beforeEach(async () => {
		await cleanup();
		process.env.SUBGRAPH_SOURCE = "streams-index";
		process.env.SUBGRAPH_INDEX_API_URL = "http://index.invalid";
		const { webhook } = await createWebhook(db, {
			accountId: randomUUID(),
			name: `${NAME_PREFIX}${randomUUID()}`,
			triggers: [{ type: "stx_transfer" }],
			url: "https://webhook.site/missing-block",
		});
		webhookId = webhook.id;
		await setCursor(FROM - 1);
	});

	afterEach(async () => {
		await cleanup();
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("stops before a height the source omits and delivers it once the source returns it", async () => {
		const missingFrom = FROM + 2;
		await runEvaluatorOnce(db, {
			httpClient: fakeHttp((h) => h < missingFrom),
		});

		expect(await cursor()).toBe(FROM + 1);
		expect(await outboxHeights()).toEqual([]);

		await runEvaluatorOnce(db, { httpClient: fakeHttp(() => true) });

		expect(await cursor()).toBe(TIP);
		expect(await outboxHeights()).toEqual([EVENT_HEIGHT]);
	});

	it("does not move the cursor or throw when the very first height is missing", async () => {
		const result = await runEvaluatorOnce(db, {
			httpClient: fakeHttp(() => false),
		});

		expect(result.advanced).toBe(false);
		expect(await cursor()).toBe(FROM - 1);
		expect(await outboxHeights()).toEqual([]);
	});

	it("recovers a height omitted from the batch when the single-height refetch returns it", async () => {
		const result = await runEvaluatorOnce(db, {
			httpClient: fakeHttp((h, single) => !(h === EVENT_HEIGHT && !single)),
		});

		expect(result.advanced).toBe(true);
		expect(await cursor()).toBe(TIP);
		expect(await outboxHeights()).toEqual([EVENT_HEIGHT]);
	});
});

describe("chain evaluator on the shared testnet stack", () => {
	const FROM = 1000;
	const TIP = FROM + 20;
	const EVENT_HEIGHT = FROM + 10;
	const NAME_PREFIX = `testnet-stack-${randomUUID()}-`;
	const savedEnv = {
		SUBGRAPH_SOURCE: process.env.SUBGRAPH_SOURCE,
		SUBGRAPH_INDEX_API_URL: process.env.SUBGRAPH_INDEX_API_URL,
		TESTNET_WEBHOOK_STACK: process.env.TESTNET_WEBHOOK_STACK,
	};
	const FRESH = () => new Date().toISOString();
	const OLD = "2026-01-01T00:00:00.000Z";
	let webhookId: string;

	type Fake = {
		tip?: number;
		blockTime?: string | null;
		/** Whether a height comes back from a batch walk / a one-height refetch. */
		available?: (height: number, singleHeight: boolean) => boolean;
		/** Heights whose one-height refetch fails like a hosted API error. */
		failSingle?: (height: number) => boolean;
	};

	function fakeHttp(cfg: Fake = {}): IndexHttpClient {
		const tip = cfg.tip ?? TIP;
		const blockTime = cfg.blockTime === undefined ? FRESH() : cfg.blockTime;
		return {
			getIndexTip: async () => tip,
			getIndexSourceTip: async () => tip,
			getDecodedHeights: () => ({ stx_transfer: tip }),
			waitIsSupported: () => true,
			walkBlocks: async (from: number, to: number) => {
				const rows = [];
				for (let h = from; h <= to; h++) {
					if (from === to && cfg.failSingle?.(h)) {
						throw new Error("hosted index unavailable");
					}
					if (!(cfg.available?.(h, from === to) ?? true)) continue;
					rows.push({
						block_height: h,
						block_hash: `0xh${h}`,
						parent_hash: `0xh${h - 1}`,
						burn_block_height: h,
						burn_block_hash: null,
						block_time: blockTime,
					});
				}
				return rows;
			},
			walkTransactions: async () => [],
			walkEvents: async (_type: string, from: number, to: number) =>
				EVENT_HEIGHT >= from && EVENT_HEIGHT <= to
					? [
							{
								event_type: "stx_transfer",
								block_height: EVENT_HEIGHT,
								tx_id: "0xtx-testnet",
								tx_index: 0,
								event_index: 0,
								contract_id: null,
								tx_sender: "ST1",
								tx_type: "token_transfer",
								tx_status: "success",
								sender: "ST1",
								recipient: "ST2",
								amount: "1000",
								memo: null,
							},
						]
					: [],
		} as unknown as IndexHttpClient;
	}

	async function outboxHeights(): Promise<number[]> {
		const rows = await db
			.selectFrom("webhook_outbox")
			.select("block_height")
			.where("webhook_id", "=", webhookId)
			.execute();
		return rows.map((r) => Number(r.block_height));
	}

	async function cleanup(): Promise<void> {
		await db
			.deleteFrom("webhooks")
			.where("name", "like", `${NAME_PREFIX}%`)
			.execute();
		await setCursor(0);
	}

	function testnet(on: boolean): void {
		if (on) process.env.TESTNET_WEBHOOK_STACK = "true";
		else delete process.env.TESTNET_WEBHOOK_STACK;
	}

	beforeEach(async () => {
		testnet(false);
		await cleanup();
		process.env.SUBGRAPH_SOURCE = "streams-index";
		process.env.SUBGRAPH_INDEX_API_URL = "http://index.invalid";
		// Created with the flag off: the webhook's account id is a throwaway.
		const { webhook } = await createWebhook(db, {
			accountId: randomUUID(),
			name: `${NAME_PREFIX}${randomUUID()}`,
			triggers: [{ type: "stx_transfer" }],
			url: "https://webhook.site/testnet-stack",
		});
		webhookId = webhook.id;
		await setCursor(FROM - 1);
	});

	afterEach(async () => {
		await cleanup();
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("rewinds the cursor to the source tip when it is 5,000 above it", async () => {
		testnet(true);
		await setCursor(TIP + 5_000);
		const gen = getChainReorgGeneration();

		const result = await runEvaluatorOnce(db, { httpClient: fakeHttp() });

		expect(result.advanced).toBe(true);
		expect(await cursor()).toBe(TIP);
		expect(getChainReorgGeneration()).toBe(gen + 1);
	});

	it("leaves a cursor that is only a reorg's depth above the tip alone", async () => {
		testnet(true);
		await setCursor(TIP + 50);

		const result = await runEvaluatorOnce(db, { httpClient: fakeHttp() });

		expect(result.idleAtTip).toBe(true);
		expect(await cursor()).toBe(TIP + 50);
	});

	it("skips a hole well below the tip and delivers the blocks after it", async () => {
		testnet(true);
		await runEvaluatorOnce(db, {
			httpClient: fakeHttp({ available: (h) => h !== FROM + 5 }),
		});

		expect(await cursor()).toBe(TIP);
		expect(await outboxHeights()).toEqual([EVENT_HEIGHT]);
	});

	it("defers a hole within six blocks of the tip", async () => {
		testnet(true);
		await runEvaluatorOnce(db, {
			httpClient: fakeHttp({ available: (h) => h !== TIP - 2 }),
		});

		expect(await cursor()).toBe(TIP - 3);
	});

	it("throws on an API error below the tip and leaves the cursor unmoved", async () => {
		testnet(true);
		const http = fakeHttp({
			available: (h, single) => single || h !== FROM + 5,
			failSingle: (h) => h === FROM + 5,
		});

		await expect(runEvaluatorOnce(db, { httpClient: http })).rejects.toThrow(
			"hosted index unavailable",
		);
		expect(await cursor()).toBe(FROM - 1);
	});

	it("does not evaluate once more than 100,000 outbox rows are pending", async () => {
		testnet(true);
		await sql`
			INSERT INTO webhook_outbox (webhook_id, block_height, row_pk, event_type, payload, dedup_key)
			SELECT ${webhookId}::uuid, 1, '{}'::jsonb, 'stx_transfer', '{}'::jsonb, 'full-' || n
			FROM generate_series(1, 100001) AS n
		`.execute(db);

		const result = await runEvaluatorOnce(db, { httpClient: fakeHttp() });

		expect(result.advanced).toBe(false);
		expect(await cursor()).toBe(FROM - 1);
		await sql`DELETE FROM webhook_outbox WHERE webhook_id = ${webhookId}::uuid`.execute(
			db,
		);
	});

	it("does not emit a block older than an hour, and the cursor still moves", async () => {
		testnet(true);
		await runEvaluatorOnce(db, { httpClient: fakeHttp({ blockTime: OLD }) });

		expect(await cursor()).toBe(TIP);
		expect(await outboxHeights()).toEqual([]);
	});

	it("emits when the block time is unknown", async () => {
		testnet(true);
		await runEvaluatorOnce(db, { httpClient: fakeHttp({ blockTime: null }) });

		expect(await cursor()).toBe(TIP);
		expect(await outboxHeights()).toEqual([EVENT_HEIGHT]);
	});

	it("emits a recent block", async () => {
		testnet(true);
		await runEvaluatorOnce(db, { httpClient: fakeHttp() });

		expect(await outboxHeights()).toEqual([EVENT_HEIGHT]);
	});

	it("flag off: a cursor 5,000 above the tip is untouched", async () => {
		await setCursor(TIP + 5_000);

		const result = await runEvaluatorOnce(db, { httpClient: fakeHttp() });

		expect(result.idleAtTip).toBe(true);
		expect(await cursor()).toBe(TIP + 5_000);
	});

	it("flag off: a mainnet hole still defers, even far below the tip", async () => {
		await runEvaluatorOnce(db, {
			httpClient: fakeHttp({ available: (h) => h !== FROM + 5 }),
		});

		expect(await cursor()).toBe(FROM + 4);
	});

	it("flag off: an old block is still emitted", async () => {
		await runEvaluatorOnce(db, { httpClient: fakeHttp({ blockTime: OLD }) });

		expect(await outboxHeights()).toEqual([EVENT_HEIGHT]);
	});
});
