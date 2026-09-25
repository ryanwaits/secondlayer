import { beforeEach, describe, expect, it } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { handleChainReorg } from "./chain-reorg.ts";
import {
	advanceCursor,
	delayAfterTick,
	getChainReorgGeneration,
	nextTickDelayMs,
	shouldWaitThisTick,
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
