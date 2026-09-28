import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	MAINNET_POX5_CYCLE_PARAMS,
	maintainPox5Cycles,
	readPox5RollupEvents,
} from "./pox5-cycles-storage.ts";
import { rollupPox5Cycles } from "./pox5-cycles.ts";
import { handlePox5Reorg, writePox5Events } from "./pox5-storage.ts";
import type { Pox5EventRow } from "./pox5-storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

// Well below reorg.test.ts's 990050 (its handleReorg assertions take
// MAX(canonical height) over blocks >= that height).
const H = 500_000;
// Mainnet burn heights so the default MAINNET_POX5_CYCLE_PARAMS (which
// rejects a burn height before genesis) accept them.
const BURN_A = 961_000; // cycle 140 (so a stake's first_reward_cycle 141 = C+1)
const BURN_B = 963_000; // cycle 141 (so a stake's first_reward_cycle 142 = C+1)

describe.skipIf(!HAS_DB)("pox5-cycles-storage maintenance", () => {
	const db = HAS_DB ? getDb() : null;

	async function cleanup() {
		if (!db) return;
		await sql`DELETE FROM pox5_events`.execute(db);
		await sql`DELETE FROM pox5_cycles`.execute(db);
		await sql`DELETE FROM pox5_cycle_signers`.execute(db);
		await db
			.deleteFrom("blocks")
			.where("height", "in", [H, H + 1])
			.execute();
		await sql`DELETE FROM decoder_checkpoints WHERE decoder_name = 'decode.pox5.v1'`.execute(
			db,
		);
	}

	beforeEach(cleanup);
	afterEach(cleanup);
	afterAll(cleanup);

	async function seedBlock(height: number, burnHeight: number) {
		if (!db) return;
		await db
			.insertInto("blocks")
			.values({
				height,
				hash: `0xpox5cyclesblock${height}`,
				parent_hash: "0xparent",
				burn_block_height: burnHeight,
				burn_block_hash: null,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
	}

	test("maintainPox5Cycles after a decoder batch matches rollupPox5Cycles of the same canonical events", async () => {
		if (!db) throw new Error("missing test db");
		await seedBlock(H, BURN_A);

		const events: Pox5EventRow[] = [
			fixtureRow({
				cursor: `${H}:0`,
				block_height: H,
				topic: "stake",
				staker: "SP_MAINT_STAKER_1",
				signer: "SP_MAINT_SIGNER_1",
				amount_ustx: "60000000000",
				first_reward_cycle: 141,
				data: { topic: "stake", "num-cycles": "3" },
			}),
		];
		await writePox5Events(events, { db });
		await maintainPox5Cycles({ db });

		const rows = await db
			.selectFrom("pox5_cycles")
			.select(["reward_cycle", "total_stacked_ustx"])
			.orderBy("reward_cycle", "asc")
			.execute();
		const signerRows = await db
			.selectFrom("pox5_cycle_signers")
			.select(["reward_cycle", "signer", "delegated_ustx", "in_set"])
			.orderBy("reward_cycle", "asc")
			.execute();

		const expected = rollupPox5Cycles(
			await readPox5RollupEvents(db),
			MAINNET_POX5_CYCLE_PARAMS,
		);

		expect(rows.map((r) => [r.reward_cycle, r.total_stacked_ustx])).toEqual(
			expected.cycles.map((c) => [
				c.reward_cycle,
				c.total_stacked_ustx.toString(),
			]),
		);
		expect(
			signerRows.map((s) => [
				s.reward_cycle,
				s.signer,
				s.delegated_ustx,
				s.in_set,
			]),
		).toEqual(
			expected.signers.map((s) => [
				s.reward_cycle,
				s.signer,
				s.delegated_ustx.toString(),
				s.in_set,
			]),
		);
		expect(rows.find((r) => r.reward_cycle === 141)?.total_stacked_ustx).toBe(
			"60000000000",
		);
	});

	test("maintainPox5Cycles after handlePox5Reorg drops the forked-out cycle data", async () => {
		if (!db) throw new Error("missing test db");
		await seedBlock(H, BURN_A);
		await seedBlock(H + 1, BURN_B);

		await writePox5Events(
			[
				fixtureRow({
					cursor: `${H}:0`,
					block_height: H,
					topic: "stake",
					staker: "SP_MAINT_STAKER_2",
					signer: "SP_MAINT_SIGNER_2",
					amount_ustx: "70000000000",
					first_reward_cycle: 141,
					data: { topic: "stake", "num-cycles": "1" },
				}),
				fixtureRow({
					cursor: `${H + 1}:0`,
					block_height: H + 1,
					topic: "stake",
					staker: "SP_MAINT_STAKER_3",
					signer: "SP_MAINT_SIGNER_3",
					amount_ustx: "80000000000",
					first_reward_cycle: 142,
					data: { topic: "stake", "num-cycles": "1" },
				}),
			],
			{ db },
		);
		await maintainPox5Cycles({ db });

		let cycle142 = await db
			.selectFrom("pox5_cycles")
			.select(["total_stacked_ustx"])
			.where("reward_cycle", "=", 142)
			.executeTakeFirst();
		expect(cycle142?.total_stacked_ustx).toBe("80000000000");

		// Simulate a reorg at H+1: the second stake's block never happened.
		await handlePox5Reorg(H + 1, { db });

		cycle142 = await db
			.selectFrom("pox5_cycles")
			.select(["total_stacked_ustx"])
			.where("reward_cycle", "=", 142)
			.executeTakeFirst();
		expect(cycle142).toBeUndefined();

		const cycle141 = await db
			.selectFrom("pox5_cycles")
			.select(["total_stacked_ustx"])
			.where("reward_cycle", "=", 141)
			.executeTakeFirst();
		expect(cycle141?.total_stacked_ustx).toBe("70000000000");

		const expected = rollupPox5Cycles(
			await readPox5RollupEvents(db),
			MAINNET_POX5_CYCLE_PARAMS,
		);
		const rows = await db
			.selectFrom("pox5_cycles")
			.select(["reward_cycle", "total_stacked_ustx"])
			.orderBy("reward_cycle", "asc")
			.execute();
		expect(rows.map((r) => [r.reward_cycle, r.total_stacked_ustx])).toEqual(
			expected.cycles.map((c) => [
				c.reward_cycle,
				c.total_stacked_ustx.toString(),
			]),
		);
	});
});

function fixtureRow(overrides: Partial<Pox5EventRow> = {}): Pox5EventRow {
	const blockHeight = overrides.block_height ?? H;
	const cursor = overrides.cursor ?? `${blockHeight}:0`;
	return {
		cursor,
		block_height: blockHeight,
		block_time: new Date("2026-07-30T09:00:00.000Z"),
		tx_id: `0x${cursor.replace(":", "")}`,
		tx_index: 0,
		event_index: 0,
		topic: "stake",
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
		data: { topic: "stake" },
		source_cursor: cursor,
		...overrides,
	};
}
