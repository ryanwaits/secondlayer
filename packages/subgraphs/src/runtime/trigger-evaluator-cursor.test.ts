import { beforeEach, describe, expect, it } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { handleChainReorg } from "./chain-reorg.ts";
import {
	MIN_REAL_WAIT_MS,
	advanceCursor,
	classifyWaitOutcome,
	delayAfterTick,
	getChainReorgGeneration,
	nextTickDelayMs,
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
