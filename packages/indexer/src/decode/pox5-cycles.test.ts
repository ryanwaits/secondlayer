import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	type Pox5CycleParams,
	type Pox5RollupEventRow,
	rollupPox5Cycles,
} from "./pox5-cycles.ts";

const MAINNET_PARAMS: Pox5CycleParams = {
	firstBurnchainBlockHeight: 666_050,
	rewardCycleLength: 2_100,
	prepareCycleLength: 100,
	firstBondPeriodCycle: 141,
};

// Small, easy-to-hand-compute params for the synthetic rule tests below —
// the rollup's cycle/burn-height math is fully parameterized, so nothing
// here depends on mainnet's real numbers.
const TEST_PARAMS: Pox5CycleParams = {
	firstBurnchainBlockHeight: 0,
	rewardCycleLength: 100,
	prepareCycleLength: 10,
	firstBondPeriodCycle: 1,
};

let seq = 0;

function row(
	overrides: Partial<Pox5RollupEventRow> & {
		topic: Pox5RollupEventRow["topic"];
		burn_block_height: number;
	},
): Pox5RollupEventRow {
	seq += 1;
	const blockHeight = overrides.block_height ?? overrides.burn_block_height;
	const cursor = overrides.cursor ?? `${blockHeight}:${seq}`;
	return {
		cursor,
		block_height: blockHeight,
		block_time: new Date("2026-01-01T00:00:00.000Z"),
		tx_id: overrides.tx_id ?? `0x${String(seq).padStart(8, "0")}`,
		tx_index: overrides.tx_index ?? 0,
		event_index: overrides.event_index ?? 0,
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
		data: {},
		source_cursor: cursor,
		canonical: true,
		...overrides,
	};
}

function cycleOf(
	cycles: ReturnType<typeof rollupPox5Cycles>["cycles"],
	n: number,
) {
	const c = cycles.find((c) => c.reward_cycle === n);
	if (!c) throw new Error(`no rollup row for cycle ${n}`);
	return c;
}

function signerOf(
	signers: ReturnType<typeof rollupPox5Cycles>["signers"],
	signer: string,
	cycle: number,
) {
	return signers.find((s) => s.signer === signer && s.reward_cycle === cycle);
}

describe("rollupPox5Cycles golden fixture", () => {
	test("reproduces the spike-verified cycle 141-144 totals exactly", () => {
		const path = new URL(
			"../../test/fixtures/pox5-cycles-golden.jsonl",
			import.meta.url,
		);
		const lines = readFileSync(path, "utf8").trim().split("\n");
		const events: Pox5RollupEventRow[] = lines.map((line) => {
			const r = JSON.parse(line);
			return {
				cursor: r.cursor,
				block_height: r.block_height,
				burn_block_height: r.burn_block_height,
				block_time: new Date(0),
				tx_id: r.tx_id,
				tx_index: r.tx_index,
				event_index: r.event_index,
				topic: r.topic,
				staker: r.staker ?? null,
				signer: r.signer ?? null,
				signer_manager: r.signer_manager ?? null,
				bond_index: r.bond_index ?? null,
				amount_ustx: r.amount_ustx ?? null,
				amount_sats: r.amount_sats ?? null,
				reward_cycle: r.reward_cycle ?? null,
				first_reward_cycle: r.first_reward_cycle ?? null,
				unlock_cycle: r.unlock_cycle ?? null,
				unlock_burn_height: null,
				is_l1_lock: r.is_l1_lock ?? null,
				signer_key: null,
				data: r.data ?? {},
				source_cursor: r.cursor,
				canonical: true,
			};
		});

		const { cycles, warnings } = rollupPox5Cycles(events, MAINNET_PARAMS);
		expect(warnings).toEqual([]);

		expect(cycleOf(cycles, 141).total_stacked_ustx).toBe(392_447_554_847_960n);
		expect(cycleOf(cycles, 142).total_stacked_ustx).toBe(421_543_815_427_560n);
		expect(cycleOf(cycles, 143).total_stacked_ustx).toBe(441_576_024_260_845n);
		expect(cycleOf(cycles, 144).total_stacked_ustx).toBe(448_329_575_893_867n);

		expect(cycleOf(cycles, 144).bond_sats["1"]).toBe("23017037628");
		expect(cycleOf(cycles, 144).sbtc_custodied_sats).toBe(16_016_587_628n);

		expect(cycleOf(cycles, 141).rewards_per_token_stx).toBe(758_607_677_183n);
		expect(cycleOf(cycles, 142).rewards_per_token_stx).toBe(909_456_324_512n);
		expect(cycleOf(cycles, 143).rewards_per_token_stx).toBe(903_631_748_280n);

		expect(cycleOf(cycles, 143).rewards_per_token_bond["1"]).toBe(
			"1199999949880604",
		);
	});
});

describe("rollupPox5Cycles rules", () => {
	test("stake-update shifts a staker to a new signer/amount only from the next cycle onward", () => {
		const staker = "ST_STAKER_1";
		const signer = "ST_SIGNER_1";
		const events = [
			row({
				topic: "stake",
				burn_block_height: 5, // cycle 0
				staker,
				signer,
				amount_ustx: "60000000000",
				first_reward_cycle: 1,
				data: { "num-cycles": "3" }, // covers cycles 1,2,3
			}),
			row({
				topic: "stake-update",
				burn_block_height: 105, // cycle 1
				staker,
				signer,
				amount_ustx: "70000000000",
				unlock_cycle: 7, // first(2) + num(5)
				data: {
					"num-cycles": "5", // covers cycles 2..6
					"cycles-to-extend": "2",
					"prev-unlock-height": "4", // info.first(1) + info.num(3)
				},
			}),
		];

		const { cycles, warnings } = rollupPox5Cycles(events, TEST_PARAMS);
		expect(warnings).toEqual([]);

		// Cycle 1 already started (current at the update) — untouched.
		expect(cycleOf(cycles, 1).total_stacked_ustx).toBe(60_000_000_000n);
		// Cycles 2..6 carry the update's new amount.
		for (const c of [2, 3, 4, 5, 6]) {
			expect(cycleOf(cycles, c).total_stacked_ustx).toBe(70_000_000_000n);
		}
	});

	test("unstake removes a staker only from the unlock cycle onward", () => {
		const staker = "ST_STAKER_2";
		const signer = "ST_SIGNER_2";
		const events = [
			row({
				topic: "stake",
				burn_block_height: 5, // cycle 0
				staker,
				signer,
				amount_ustx: "55000000000",
				first_reward_cycle: 1,
				data: { "num-cycles": "4" }, // covers cycles 1..4
			}),
			row({
				topic: "unstake",
				burn_block_height: 205, // cycle 2
				staker,
				unlock_cycle: 3,
				data: {},
			}),
		];

		const { cycles } = rollupPox5Cycles(events, TEST_PARAMS);

		expect(cycleOf(cycles, 1).total_stacked_ustx).toBe(55_000_000_000n);
		expect(cycleOf(cycles, 2).total_stacked_ustx).toBe(55_000_000_000n);
		expect(cycleOf(cycles, 3).total_stacked_ustx).toBe(0n);
		expect(cycleOf(cycles, 3).stakers).toBe(0);
		expect(cycleOf(cycles, 4).total_stacked_ustx).toBe(0n);
	});

	test("a signer only earns reward shares once combined delegation crosses 50,000 STX", () => {
		const signer = "ST_SIGNER_3";
		const events = [
			row({
				topic: "stake",
				burn_block_height: 5,
				staker: "ST_STAKER_3A",
				signer,
				amount_ustx: "40000000000", // 40k STX — below the threshold alone
				first_reward_cycle: 1,
				data: { "num-cycles": "1" },
			}),
		];
		const belowThreshold = rollupPox5Cycles(events, TEST_PARAMS);
		expect(cycleOf(belowThreshold.cycles, 1).total_stacked_ustx).toBe(
			40_000_000_000n,
		);
		expect(cycleOf(belowThreshold.cycles, 1).reward_eligible_ustx).toBe(0n);
		const signerBelow = signerOf(belowThreshold.signers, signer, 1);
		expect(signerBelow?.in_set).toBe(false);
		expect(signerBelow?.reward_shares_ustx).toBe(0n);
		expect(signerBelow?.stx_only_ustx).toBe(40_000_000_000n);

		events.push(
			row({
				topic: "stake",
				burn_block_height: 5,
				staker: "ST_STAKER_3B",
				signer,
				amount_ustx: "15000000000", // combined 55k STX — crosses the threshold
				first_reward_cycle: 1,
				data: { "num-cycles": "1" },
			}),
		);
		const { cycles, signers } = rollupPox5Cycles(events, TEST_PARAMS);
		expect(cycleOf(cycles, 1).total_stacked_ustx).toBe(55_000_000_000n);
		// Crossing the threshold makes the FULL combined delegation
		// reward-eligible, not just the marginal top-up.
		expect(cycleOf(cycles, 1).reward_eligible_ustx).toBe(55_000_000_000n);
		const signerAbove = signerOf(signers, signer, 1);
		expect(signerAbove?.in_set).toBe(true);
		expect(signerAbove?.reward_shares_ustx).toBe(55_000_000_000n);
	});

	test("register-for-bond adds to delegated and can join the signer set, but never earns STX reward shares", () => {
		const staker = "ST_STAKER_4";
		const signer = "ST_SIGNER_4";
		const events = [
			row({
				topic: "register-for-bond",
				burn_block_height: 5,
				staker,
				signer,
				bond_index: 0,
				first_reward_cycle: 1, // = bondPeriodToRewardCycle(0, TEST_PARAMS)
				amount_ustx: "100000000000", // 100k STX — well above the threshold
				amount_sats: "5000000000",
				is_l1_lock: false,
			}),
		];

		const { cycles, signers } = rollupPox5Cycles(events, TEST_PARAMS);

		expect(cycleOf(cycles, 1).total_stacked_ustx).toBe(100_000_000_000n);
		expect(cycleOf(cycles, 1).reward_eligible_ustx).toBe(0n);
		expect(cycleOf(cycles, 1).bond_sats["0"]).toBe("5000000000");
		expect(cycleOf(cycles, 1).bond_total_sats).toBe(5_000_000_000n);

		const signerRow = signerOf(signers, signer, 1);
		expect(signerRow?.delegated_ustx).toBe(100_000_000_000n);
		expect(signerRow?.in_set).toBe(true); // crosses 50k delegated
		expect(signerRow?.reward_shares_ustx).toBe(0n); // never STX-eligible
		expect(signerRow?.stx_only_ustx).toBe(0n);
	});

	test("unstake-sbtc withdraws a bond's sats from the current cycle onward, leaving past cycles untouched", () => {
		const staker = "ST_STAKER_5";
		const signer = "ST_SIGNER_5";
		const events = [
			row({
				topic: "register-for-bond",
				burn_block_height: 5, // cycle 0
				staker,
				signer,
				bond_index: 0,
				first_reward_cycle: 1, // bondStart
				amount_ustx: "60000000000",
				amount_sats: "5000000000",
				is_l1_lock: false,
			}),
			row({
				topic: "unstake-sbtc",
				burn_block_height: 250, // cycle 2, inside [bondStart 1, bondEnd 13)
				staker,
				signer,
				bond_index: 0,
				amount_sats: "2000000000", // withdrawn
				data: { "new-amount-sats": "3000000000" },
			}),
		];

		const { cycles } = rollupPox5Cycles(events, TEST_PARAMS);

		expect(cycleOf(cycles, 1).bond_sats["0"]).toBe("5000000000"); // past cycle: untouched
		expect(cycleOf(cycles, 2).bond_sats["0"]).toBe("3000000000");
		expect(cycleOf(cycles, 12).bond_sats["0"]).toBe("3000000000");
	});

	test("two distributions in a cycle sum allocated rewards and report the latest cumulative rewards-per-token", () => {
		const staker = "ST_STAKER_6";
		const signer = "ST_SIGNER_6";
		const events = [
			row({
				topic: "stake",
				burn_block_height: 5,
				staker,
				signer,
				amount_ustx: "999",
				first_reward_cycle: 1,
				data: { "num-cycles": "10" },
			}),
			row({
				topic: "calculate-rewards",
				burn_block_height: 150,
				tx_id: "0xdist1",
				data: {
					"stx-cycle": "5",
					"cycle-staked-ustx": "999",
					"reserve-deposit": "10",
					"total-stx-staker-rewards": "1000",
					"cumulative-rewards-per-ustx": "1000",
				},
			}),
			row({
				topic: "calculate-rewards",
				burn_block_height: 160,
				tx_id: "0xdist2",
				data: {
					"stx-cycle": "5",
					"cycle-staked-ustx": "999",
					"reserve-deposit": "20",
					"total-stx-staker-rewards": "1500",
					"cumulative-rewards-per-ustx": "2500",
				},
			}),
			row({
				topic: "bond-distribution",
				burn_block_height: 160,
				tx_id: "0xdist2", // paired with the second calculate-rewards, same tx
				bond_index: 7,
				data: { "bond-rewards": "500", "cumulative-rewards-per-sat": "12345" },
			}),
		];

		const { cycles } = rollupPox5Cycles(events, TEST_PARAMS);
		const cycle5 = cycleOf(cycles, 5);

		expect(cycle5.reward_eligible_ustx).toBe(999n); // from the print, not derived
		expect(cycle5.distributions).toBe(2);
		expect(cycle5.rewards_allocated_stx).toBe(2500n); // 1000 + 1500
		expect(cycle5.reserve_deposit).toBe(30n); // 10 + 20
		expect(cycle5.rewards_per_token_stx).toBe(2500n); // the latest, not the first
		expect(cycle5.rewards_allocated_bond).toBe(500n);
		expect(cycle5.rewards_per_token_bond["7"]).toBe("12345");
	});

	test("claim-rewards and claim-staker-rewards-for-signer both add to a signer's claimed total for the cycle", () => {
		const signer = "ST_SIGNER_7";
		const events = [
			row({
				topic: "claim-rewards",
				burn_block_height: 400,
				signer,
				reward_cycle: 5,
				data: { "total-rewards": "777" },
			}),
			row({
				topic: "claim-staker-rewards-for-signer",
				burn_block_height: 400,
				signer,
				staker: "ST_STAKER_7",
				reward_cycle: 5,
				data: { "rewards-claimed": "223" },
			}),
		];

		const { cycles, signers } = rollupPox5Cycles(events, TEST_PARAMS);
		expect(cycleOf(cycles, 5).rewards_claimed).toBe(1000n);
		expect(signerOf(signers, signer, 5)?.rewards_claimed).toBe(1000n);
	});

	// UNPROVEN ON MAINNET: zero `update-bond-registration` events have ever
	// been observed. This exercises the port of pox-5.clar's handler
	// (stacks-core 4.0.1) against a synthetic sequence only.
	test("update-bond-registration re-points a bond staker at a new signer from the next cycle onward (unproven on mainnet)", () => {
		const staker = "ST_STAKER_8";
		const oldSigner = "ST_SIGNER_8_OLD";
		const newSigner = "ST_SIGNER_8_NEW";
		const events = [
			row({
				topic: "register-for-bond",
				burn_block_height: 5, // cycle 0
				staker,
				signer: oldSigner,
				bond_index: 0,
				first_reward_cycle: 1, // bondStart
				amount_ustx: "80000000000",
				amount_sats: "4000000000",
				is_l1_lock: false,
			}),
			row({
				topic: "update-bond-registration",
				burn_block_height: 105, // cycle 1
				staker,
				signer: newSigner, // the contract prints the NEW signer under `signer`
				bond_index: 0,
				first_reward_cycle: 2, // clamp(C+1=2, bondStart=1, bondEnd=13)
				amount_ustx: "80000000000",
				amount_sats: "4000000000",
				is_l1_lock: false,
				data: { "old-signer": oldSigner, "num-cycles": "11" }, // bondEnd(13) - first(2)
			}),
		];

		const { cycles, signers, warnings } = rollupPox5Cycles(events, TEST_PARAMS);
		expect(warnings).toEqual([]);

		// The bond's total size is unaffected — ownership moved, nothing unstaked.
		expect(cycleOf(cycles, 1).bond_sats["0"]).toBe("4000000000");
		expect(cycleOf(cycles, 2).bond_sats["0"]).toBe("4000000000");

		// Cycle 1 (already current at the switch) still credits the old signer.
		expect(signerOf(signers, oldSigner, 1)?.delegated_ustx).toBe(
			80_000_000_000n,
		);
		expect(signerOf(signers, oldSigner, 1)?.in_set).toBe(true);

		// Cycle 2 onward moves to the new signer; the old signer drops out.
		expect(signerOf(signers, newSigner, 2)?.delegated_ustx).toBe(
			80_000_000_000n,
		);
		expect(signerOf(signers, newSigner, 2)?.in_set).toBe(true);
		expect(signerOf(signers, oldSigner, 2)?.delegated_ustx).toBe(0n);
		expect(signerOf(signers, oldSigner, 2)?.in_set).toBe(false);
	});

	// UNPROVEN ON MAINNET: zero `announce-l1-early-exit` events have ever
	// been observed. This exercises the port of pox-5.clar's handler
	// (stacks-core 4.0.1) against a synthetic sequence only.
	test("announce-l1-early-exit fully releases an L1-locked bond without touching global sBTC custody (unproven on mainnet)", () => {
		const staker = "ST_STAKER_9";
		const signer = "ST_SIGNER_9";
		const events = [
			row({
				topic: "register-for-bond",
				burn_block_height: 5, // cycle 0
				staker,
				signer,
				bond_index: 1,
				first_reward_cycle: 3, // bondPeriodToRewardCycle(1, TEST_PARAMS) = 1 + 1*2
				amount_ustx: "90000000000",
				amount_sats: "6000000000",
				is_l1_lock: true,
			}),
			row({
				topic: "announce-l1-early-exit",
				burn_block_height: 305, // cycle 3 — the bond's start cycle
				staker,
				signer,
				bond_index: 1,
				amount_sats: "6000000000", // amount-sats-released: the full balance
			}),
		];

		const { cycles } = rollupPox5Cycles(events, TEST_PARAMS);

		// L1-locked sats never counted toward custodied sBTC, before or after.
		expect(cycleOf(cycles, 3).sbtc_custodied_sats).toBe(0n);
		expect(cycleOf(cycles, 14).sbtc_custodied_sats).toBe(0n);
		// Fully released from the current cycle through the bond's end.
		expect(cycleOf(cycles, 3).bond_sats["1"]).toBe("0");
		expect(cycleOf(cycles, 14).bond_sats["1"]).toBe("0");
	});
});
