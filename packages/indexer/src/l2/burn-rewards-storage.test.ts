import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type { NewBurnBlockPayload } from "../types/node-events.ts";
import { persistBurnBlockRewards } from "./burn-rewards-storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("burn-rewards-storage", () => {
	const db = HAS_DB ? getDb() : null;

	async function clear() {
		if (!db) return;
		await sql`DELETE FROM burn_block_rewards`.execute(db);
		await sql`DELETE FROM burn_block_reward_slots`.execute(db);
	}

	beforeEach(clear);
	afterEach(clear);

	test("persists reward payouts and slot holders, one row per index", async () => {
		if (!db) throw new Error("missing test db");
		const res = await persistBurnBlockRewards(
			fixturePayload({
				burn_block_height: 951_000,
				burn_block_hash: "0xaaa",
				burn_amount: 0,
				reward_recipients: [
					{ recipient: "bc1qone", amt: 65000 },
					{ recipient: "bc1qtwo", amt: 65000 },
				],
				reward_slot_holders: ["bc1qone", "bc1qtwo"],
			}),
			{ db },
		);
		expect(res).toEqual({ rewards: 2, slots: 2 });

		const rewards = await db
			.selectFrom("burn_block_rewards")
			.select(["cursor", "reward_index", "recipient_btc", "amount_sats"])
			.orderBy("reward_index")
			.execute();
		expect(rewards).toEqual([
			{
				cursor: "951000:0",
				reward_index: 0,
				recipient_btc: "bc1qone",
				amount_sats: "65000",
			},
			{
				cursor: "951000:1",
				reward_index: 1,
				recipient_btc: "bc1qtwo",
				amount_sats: "65000",
			},
		]);
	});

	// T4 regression: a burnchain reorg re-delivers the same height with a
	// different hash + different recipients. Replace-per-height must leave only
	// the new fork's rows — no stale rows from the orphaned hash.
	test("replace-per-height on burnchain reorg at same height", async () => {
		if (!db) throw new Error("missing test db");
		await persistBurnBlockRewards(
			fixturePayload({
				burn_block_height: 951_000,
				burn_block_hash: "0xfork_a",
				reward_recipients: [
					{ recipient: "bc1qold0", amt: 1 },
					{ recipient: "bc1qold1", amt: 2 },
				],
				reward_slot_holders: ["bc1qold0", "bc1qold1"],
			}),
			{ db },
		);
		await persistBurnBlockRewards(
			fixturePayload({
				burn_block_height: 951_000,
				burn_block_hash: "0xfork_b",
				reward_recipients: [{ recipient: "bc1qnew0", amt: 9 }],
				reward_slot_holders: ["bc1qnew0"],
			}),
			{ db },
		);

		const rewards = await db
			.selectFrom("burn_block_rewards")
			.select(["cursor", "burn_block_hash", "recipient_btc"])
			.orderBy("cursor")
			.execute();
		expect(rewards).toEqual([
			{
				cursor: "951000:0",
				burn_block_hash: "0xfork_b",
				recipient_btc: "bc1qnew0",
			},
		]);

		const slots = await db
			.selectFrom("burn_block_reward_slots")
			.select(["cursor", "holder_btc"])
			.orderBy("cursor")
			.execute();
		expect(slots).toEqual([{ cursor: "951000:0", holder_btc: "bc1qnew0" }]);
	});

	// Prepare-phase blocks carry empty arrays; nothing is written, and any prior
	// rows at that height are cleared (replace-per-height with empty payload).
	test("prepare-phase payload writes no rows and clears the height", async () => {
		if (!db) throw new Error("missing test db");
		await persistBurnBlockRewards(
			fixturePayload({
				burn_block_height: 951_000,
				burn_block_hash: "0xreward",
				reward_recipients: [{ recipient: "bc1qx", amt: 5 }],
				reward_slot_holders: ["bc1qx"],
			}),
			{ db },
		);
		const res = await persistBurnBlockRewards(
			fixturePayload({
				burn_block_height: 951_000,
				burn_block_hash: "0xprepare",
				burn_amount: 160000,
				reward_recipients: [],
				reward_slot_holders: [],
			}),
			{ db },
		);
		expect(res).toEqual({ rewards: 0, slots: 0 });

		const count = await db
			.selectFrom("burn_block_rewards")
			.select(db.fn.countAll().as("n"))
			.executeTakeFirst();
		expect(Number(count?.n ?? 0)).toBe(0);
	});
});

function fixturePayload(
	overrides: Partial<NewBurnBlockPayload> = {},
): NewBurnBlockPayload {
	return {
		burn_block_hash: "0xaaa",
		burn_block_height: 951_000,
		consensus_hash: "0xconsensus",
		parent_burn_block_hash: "0xparent",
		burn_amount: 0,
		reward_recipients: [],
		reward_slot_holders: [],
		pox_transactions: [],
		...overrides,
	};
}
