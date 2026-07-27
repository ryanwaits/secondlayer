import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, jsonb, sql } from "@secondlayer/shared/db";
import {
	_resetPox4EraCacheForTests,
	isPox4EraClosed,
	readPox4EraClosed,
} from "./pox-era.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe("PoX-4 era probe", () => {
	beforeEach(() => {
		_resetPox4EraCacheForTests();
	});

	test("reports the era open while no pox-5 event exists", async () => {
		expect(await isPox4EraClosed({ read: async () => false })).toBe(false);
	});

	test("reports the era closed once a pox-5 event exists", async () => {
		expect(await isPox4EraClosed({ read: async () => true })).toBe(true);
	});

	test("caches a closed era permanently, ignoring a later false", async () => {
		let answer = true;
		const read = async () => answer;
		expect(await isPox4EraClosed({ read })).toBe(true);
		answer = false;
		expect(await isPox4EraClosed({ read })).toBe(true);
	});

	test("re-probes while the era is still open", async () => {
		let answer = false;
		const read = async () => answer;
		expect(await isPox4EraClosed({ read })).toBe(false);
		_resetPox4EraCacheForTests();
		answer = true;
		expect(await isPox4EraClosed({ read })).toBe(true);
	});

	test("a failing probe resolves to open rather than throwing", async () => {
		const read = async () => {
			throw new Error("connection terminated unexpectedly");
		};
		expect(await isPox4EraClosed({ read })).toBe(false);
	});

	test("the reset helper clears a cached answer", async () => {
		expect(await isPox4EraClosed({ read: async () => true })).toBe(true);
		_resetPox4EraCacheForTests();
		expect(await isPox4EraClosed({ read: async () => false })).toBe(false);
	});
});

describe.skipIf(!HAS_DB)("PoX-4 era probe DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	function pox5Row(cursor: string, canonical: boolean) {
		return {
			cursor,
			block_height: 900_000,
			block_time: new Date("2026-07-30T00:00:00.000Z"),
			tx_id: `0x${cursor}`,
			tx_index: 0,
			event_index: 0,
			topic: "stake" as const,
			staker: null,
			signer: null,
			signer_manager: null,
			bond_index: null,
			amount_ustx: null,
			amount_sats: null,
			reward_cycle: null,
			first_reward_cycle: null,
			unlock_cycle: null,
			unlock_burn_height: null,
			is_l1_lock: null,
			signer_key: null,
			data: jsonb({ topic: "stake" }),
			canonical,
			source_cursor: cursor,
		};
	}

	beforeEach(async () => {
		_resetPox4EraCacheForTests();
		if (!db) return;
		await sql`DELETE FROM pox5_events`.execute(db);
	});

	test("an empty pox5_events table means the era is still open", async () => {
		if (!db) throw new Error("missing db");
		expect(await readPox4EraClosed(db)).toBe(false);
	});

	test("one canonical pox-5 event closes the era", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("pox5_events")
			.values([pox5Row("900000:0", true)])
			.execute();
		expect(await readPox4EraClosed(db)).toBe(true);
	});

	test("a reorged-away pox-5 event alone leaves the era open", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("pox5_events")
			.values([pox5Row("900000:1", false)])
			.execute();
		expect(await readPox4EraClosed(db)).toBe(false);
	});
});
