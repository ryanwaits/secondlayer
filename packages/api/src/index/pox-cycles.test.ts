import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb, jsonb, sql } from "@secondlayer/shared/db";
import {
	FIRST_POX5_REWARD_CYCLE,
	getPoxCycleResponse,
	getPoxCyclesResponse,
	readPoxCycle,
} from "./pox-cycles.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};

function params(query = "") {
	return new URL(`http://localhost/v1/index/pox/cycles${query}`).searchParams;
}

function cycleRow(
	rewardCycle: number,
	overrides: Record<string, unknown> = {},
) {
	const startBurnHeight = 666_050 + rewardCycle * 2_100;
	return {
		reward_cycle: rewardCycle,
		start_burn_height: startBurnHeight,
		prepare_start_burn_height: startBurnHeight - 100,
		end_burn_height: startBurnHeight + 2_099,
		total_stacked_ustx: "1000000",
		reward_eligible_ustx: "1000000",
		stakers: 1,
		signers_in_set: 1,
		bond_sats: jsonb({ "1": "500" }),
		bond_total_sats: "500",
		sbtc_custodied_sats: "0",
		rewards_allocated_stx: "0",
		rewards_allocated_bond: "0",
		reserve_deposit: "0",
		rewards_per_token_stx: null,
		rewards_per_token_bond: jsonb({}),
		distributions: 0,
		rewards_claimed: "0",
		computed_through_height: 9_000,
		...overrides,
	};
}

describe.skipIf(!HAS_DB)("PoX-5 cycles", () => {
	const db = HAS_DB ? getDb() : null;
	const CYCLES = [900_001, 900_002, 900_003];

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM pox5_cycles WHERE reward_cycle IN (900001, 900002, 900003)`.execute(
			db,
		);
		await sql`DELETE FROM pox5_cycle_signers WHERE reward_cycle IN (900001, 900002, 900003)`.execute(
			db,
		);
		await db
			.insertInto("pox5_cycles")
			.values(CYCLES.map((c) => cycleRow(c)))
			.execute();
		await db
			.insertInto("pox5_cycle_signers")
			.values([
				{
					reward_cycle: 900_002,
					signer: "SP_SIGNER_1",
					delegated_ustx: "1000000",
					stx_only_ustx: "1000000",
					reward_shares_ustx: "1000000",
					in_set: true,
					rewards_claimed: "0",
				},
			])
			.execute();
	});

	afterAll(async () => {
		if (!db) return;
		await sql`DELETE FROM pox5_cycles WHERE reward_cycle IN (900001, 900002, 900003)`.execute(
			db,
		);
		await sql`DELETE FROM pox5_cycle_signers WHERE reward_cycle IN (900001, 900002, 900003)`.execute(
			db,
		);
	});

	test("lists cycles newest-first with pox_version 5", async () => {
		const response = await getPoxCyclesResponse({
			query: params(),
			tip: TIP,
			tipBurnHeight: 0,
		});
		expect(response.pox_version).toBe(5);
		const returned = response.cycles.filter((c) =>
			CYCLES.includes(c.reward_cycle),
		);
		expect(returned.map((c) => c.reward_cycle)).toEqual([
			900_003, 900_002, 900_001,
		]);
	});

	test("paginates by reward_cycle cursor", async () => {
		// Cursor explicitly, rather than starting from the unscoped top of the
		// table — other suites seed their own pox5_cycles rows in the same
		// shared test DB.
		const first = await getPoxCyclesResponse({
			query: params("?limit=1&cursor=900004"),
			tip: TIP,
			tipBurnHeight: 0,
		});
		expect(first.cycles.map((c) => c.reward_cycle)).toEqual([900_003]);
		expect(first.next_cursor).toBe(900_003);

		const page = await getPoxCyclesResponse({
			query: params("?limit=1&cursor=900003"),
			tip: TIP,
			tipBurnHeight: 0,
		});
		expect(page.cycles[0]?.reward_cycle).toBe(900_002);
	});

	test("rejects an out-of-range limit", async () => {
		await expect(
			getPoxCyclesResponse({ query: params("?limit=0"), tip: TIP }),
		).rejects.toThrow();
	});

	test("a single cycle carries its signers", async () => {
		const result = await getPoxCycleResponse({
			rewardCycle: 900_002,
			tip: TIP,
			tipBurnHeight: 0,
		});
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("expected ok");
		expect(result.response.pox_version).toBe(5);
		expect(result.response.cycle.reward_cycle).toBe(900_002);
		expect(result.response.cycle.signers).toEqual([
			{
				signer: "SP_SIGNER_1",
				delegated_ustx: "1000000",
				stx_only_ustx: "1000000",
				reward_shares_ustx: "1000000",
				in_set: true,
				rewards_claimed: "0",
			},
		]);
	});

	test("404s (not_found) for a pox-5 cycle number with no rollup row", async () => {
		const result = await getPoxCycleResponse({
			rewardCycle: 5_000,
			tip: TIP,
			tipBurnHeight: 0,
		});
		expect(result.kind).toBe("not_found");
	});

	test("404s below the first pox-5 reward cycle with a pox4-not-served note, never touching the reader", async () => {
		let called = false;
		const result = await getPoxCycleResponse({
			rewardCycle: FIRST_POX5_REWARD_CYCLE - 1,
			tip: TIP,
			tipBurnHeight: 0,
			readPoxCycle: async () => {
				called = true;
				return null;
			},
		});
		expect(result.kind).toBe("pox4_not_served");
		expect(called).toBe(false);
	});

	test("is_current is true only for the cycle containing the tip's burn height", async () => {
		const cycle142StartBurnHeight = 666_050 + 900_002 * 2_100;
		const response = await getPoxCyclesResponse({
			query: params(),
			tip: TIP,
			tipBurnHeight: cycle142StartBurnHeight + 5,
		});
		const byCycle = new Map(response.cycles.map((c) => [c.reward_cycle, c]));
		expect(byCycle.get(900_002)?.is_current).toBe(true);
		expect(byCycle.get(900_001)?.is_current).toBe(false);
		expect(byCycle.get(900_003)?.is_current).toBe(false);
	});

	test("is_frozen is true once the tip passes a cycle's prepare_start_burn_height, even for a not-yet-current cycle", async () => {
		// A tip inside 141's own window, but past 142's prepare phase — 142 is
		// closed for new registrations though it isn't "current" yet.
		const cycle142PrepareStart = 666_050 + 900_002 * 2_100 - 100;
		const response = await getPoxCyclesResponse({
			query: params(),
			tip: TIP,
			tipBurnHeight: cycle142PrepareStart,
		});
		const byCycle = new Map(response.cycles.map((c) => [c.reward_cycle, c]));
		expect(byCycle.get(900_002)?.is_frozen).toBe(true);
		expect(byCycle.get(900_003)?.is_frozen).toBe(false);
	});

	test("POX4_DECODER_ENABLED=false has no effect on the pox-5 endpoint", async () => {
		const prev = process.env.POX4_DECODER_ENABLED;
		process.env.POX4_DECODER_ENABLED = "false";
		try {
			const response = await getPoxCyclesResponse({
				query: params(),
				tip: TIP,
				tipBurnHeight: 0,
			});
			const returned = response.cycles.filter((c) =>
				CYCLES.includes(c.reward_cycle),
			);
			expect(returned.length).toBe(3);
			expect("notes" in response).toBe(false);
		} finally {
			if (prev === undefined) delete process.env.POX4_DECODER_ENABLED;
			else process.env.POX4_DECODER_ENABLED = prev;
		}
	});
});

// The single-cycle read groups aggregates with no GROUP BY on the pox-4
// rollup used to reject at plan time (42803, see git history); the pox-5
// version reads a plain per-cycle row instead, so this just guards the
// canonical/non-existent-cycle cases still resolve correctly.
describe.skipIf(!HAS_DB)("readPoxCycle against Postgres", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM pox5_cycles WHERE reward_cycle = 999001`.execute(db);
		await db.insertInto("pox5_cycles").values(cycleRow(999_001)).execute();
	});

	afterAll(async () => {
		if (!db) return;
		await sql`DELETE FROM pox5_cycles WHERE reward_cycle = 999001`.execute(db);
	});

	test("a known cycle resolves with an empty signer list when none are recorded", async () => {
		if (!db) return;
		const result = await readPoxCycle(999_001, db);
		expect(result).not.toBeNull();
		expect(result?.cycle.reward_cycle).toBe(999_001);
		expect(result?.signers).toEqual([]);
	});

	test("an unknown cycle returns null so the route can answer 404", async () => {
		if (!db) return;
		expect(await readPoxCycle(999_002, db)).toBeNull();
	});
});
