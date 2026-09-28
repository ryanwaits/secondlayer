/**
 * Pure per-cycle PoX-5 rollup. Ports `plans/assets/078/replay.ts` — a replay
 * of pox-5.clar's per-cycle contract state that was verified exact against
 * the node's own read-onlies (cycles 141-144: total stacked, reward shares,
 * bond totals, signer set) — into repo style: typed, bigint math, no `any`.
 *
 * No I/O. Callers (the maintenance path in `pox5-cycles-storage.ts`) own
 * reading `pox5_events` + `blocks` and writing the result; this function only
 * turns an ordered event log into the materialized `pox5_cycles` /
 * `pox5_cycle_signers` rows.
 *
 * Two topics have never fired on mainnet as of this port
 * (`update-bond-registration`, `announce-l1-early-exit`). Their handling
 * below is ported from the pinned pox-5.clar source
 * (stacks-core 4.0.1, see `scripts/ci/check-pox5-pin.ts`) rather than from
 * observed events, and is UNPROVEN on mainnet — see the doc comments on
 * each case.
 */

import {
	type BondCycleParams,
	bondPeriodToRewardCycle,
	burnHeightToRewardCycle,
	rewardCycleToBurnHeight,
} from "@secondlayer/stacks/pox5";
import { BOND_GAP_CYCLES, BOND_LENGTH_CYCLES } from "@secondlayer/stacks/pox5";
import type { Pox5EventRow } from "./pox5-storage.ts";

/** A signer needs >= 50,000 STX (micro-STX) delegated to earn rewards — the
 *  threshold that separates `delegated` from `reward_shares`. */
const MIN_SIGNER_USTX = 50_000_000_000n;

/** A bond's active window, in reward cycles (12 = `BOND_LENGTH_CYCLES`). */
const BOND_WINDOW_CYCLES = BOND_GAP_CYCLES * 6;

export type Pox5CycleParams = BondCycleParams & {
	/** `/v2/pox` `prepare_cycle_length` (mainnet 100). */
	prepareCycleLength: number;
};

/**
 * A `pox5_events` row plus the burn height of the block it landed in. The
 * rollup needs `burn_block_height` for `current-pox-reward-cycle` math the
 * print tuples themselves don't always carry (`unstake-sbtc`,
 * `update-bond-registration`, `announce-l1-early-exit`); pox5_events doesn't
 * store it, so the maintenance path joins it in from `blocks`.
 */
export type Pox5RollupEventRow = Pox5EventRow & {
	burn_block_height: number;
	canonical: boolean;
};

export type Pox5CycleRow = {
	reward_cycle: number;
	start_burn_height: number;
	prepare_start_burn_height: number;
	end_burn_height: number;
	/** STX + bond ustx delegated to signers this cycle (`ustx-delegated-per-cycle`). */
	total_stacked_ustx: bigint;
	/** STX actually counted toward rewards (>= 50k-per-signer threshold met). */
	reward_eligible_ustx: bigint;
	stakers: number;
	signers_in_set: number;
	/** bond index (as string) -> sats staked for this cycle. */
	bond_sats: Record<string, string>;
	bond_total_sats: bigint;
	/** Global running total (`get-total-sbtc-staked` takes no cycle argument);
	 *  stamped identically on every row as of the last processed event. */
	sbtc_custodied_sats: bigint;
	rewards_allocated_stx: bigint;
	rewards_allocated_bond: bigint;
	reserve_deposit: bigint;
	rewards_per_token_stx: bigint | null;
	/** bond index (as string) -> cumulative rewards-per-sat for this cycle. */
	rewards_per_token_bond: Record<string, string>;
	distributions: number;
	rewards_claimed: bigint;
	computed_through_height: number;
};

export type Pox5CycleSignerRow = {
	reward_cycle: number;
	signer: string;
	delegated_ustx: bigint;
	stx_only_ustx: bigint;
	reward_shares_ustx: bigint;
	in_set: boolean;
	rewards_claimed: bigint;
};

export type Pox5RollupWarning = { message: string; cursor: string };

export type Pox5RollupResult = {
	cycles: Pox5CycleRow[];
	signers: Pox5CycleSignerRow[];
	/** Consistency-check messages (a contract invariant the replay expected
	 *  didn't hold for some event). Never thrown — informational, mirroring
	 *  `replay.ts`'s `warn` list. */
	warnings: Pox5RollupWarning[];
};

function tuple(e: Pox5RollupEventRow): Record<string, unknown> {
	return (e.data ?? {}) as Record<string, unknown>;
}

function bigOf(v: unknown): bigint {
	if (v === null || v === undefined) return 0n;
	if (typeof v === "bigint") return v;
	if (typeof v === "number") return BigInt(Math.trunc(v));
	return BigInt(v as string);
}

function numOf(v: unknown): number {
	if (v === null || v === undefined) return 0;
	return Number(v);
}

function strOf(v: unknown): string | null {
	return typeof v === "string" ? v : null;
}

function clampCycle(c: number, lo: number, hi: number): number {
	return Math.min(Math.max(c, lo), hi);
}

const key = (...parts: (string | number)[]): string => parts.join("|");

type StakerInfo = {
	amount: bigint;
	first: number;
	num: number;
	signer: string;
};
type BondMember = {
	bond: number;
	amount: bigint;
	signer: string;
	l1: boolean;
	sats: bigint;
};
type RewardEvent = {
	topic:
		| "calculate-rewards"
		| "bond-distribution"
		| "claim-rewards"
		| "claim-staker-rewards-for-signer";
	tx_id: string;
	e: Pox5RollupEventRow;
};

export function rollupPox5Cycles(
	events: readonly Pox5RollupEventRow[],
	params: Pox5CycleParams,
): Pox5RollupResult {
	const ordered = [...events]
		.filter((e) => e.canonical)
		.sort((a, b) =>
			a.block_height !== b.block_height
				? a.block_height - b.block_height
				: a.tx_index !== b.tx_index
					? a.tx_index - b.tx_index
					: a.event_index - b.event_index,
		);

	// Maps mirroring the contract's own per-cycle storage.
	const ustxDelegated = new Map<number, bigint>(); // ustx-delegated-per-cycle
	const signerDelegated = new Map<string, bigint>(); // (signer|cycle) -> amount-delegated-for-signer
	const signerPending = new Map<string, bigint>(); // (signer|cycle) -> signer-pending-staked-ustx-per-cycle
	const signerShares = new Map<string, bigint>(); // (cycle|bond|signer) -> signer-shares-staked-for-cycle
	const totalShares = new Map<string, bigint>(); // (cycle|bond) -> total-shares-staked-for-cycle
	const stakerShares = new Map<string, bigint>(); // (cycle|bond|staker|signer)
	const inSet = new Set<string>(); // (signer|cycle) -> signer-set membership
	const membership = new Map<string, { signer: string; amount: bigint }>(); // (staker|cycle)
	const stakerInfo = new Map<string, StakerInfo>();
	const bondMember = new Map<string, BondMember>();
	const bondTotal = new Map<number, bigint>();
	let totalSbtc = 0n;
	let maxBlockHeight = 0;

	const warnings: Pox5RollupWarning[] = [];
	const warn = (e: Pox5RollupEventRow, message: string) =>
		warnings.push({ message, cursor: e.cursor });
	function g<K>(m: Map<K, bigint>, k: K): bigint {
		return m.get(k) ?? 0n;
	}

	function addSignerCycle(
		staker: string,
		signer: string,
		c: number,
		amount: bigint,
		isStx: boolean,
	): void {
		const cur = g(signerDelegated, key(signer, c));
		const stakeAmt = isStx ? amount : 0n;
		const prevStaked = g(signerPending, key(signer, c));
		const prevTotal = g(totalShares, key(c, "none"));
		const nd = cur + amount;
		if (nd >= MIN_SIGNER_USTX) {
			signerShares.set(key(c, "none", signer), prevStaked + stakeAmt);
			if (cur < MIN_SIGNER_USTX) {
				inSet.add(key(signer, c));
				totalShares.set(key(c, "none"), prevTotal + prevStaked + stakeAmt);
			} else {
				totalShares.set(key(c, "none"), prevTotal + stakeAmt);
			}
		}
		membership.set(key(staker, c), { signer, amount });
		signerDelegated.set(key(signer, c), nd);
		signerPending.set(key(signer, c), prevStaked + stakeAmt);
		stakerShares.set(key(c, "none", staker, signer), stakeAmt);
		ustxDelegated.set(c, g(ustxDelegated, c) + amount);
	}

	function removeSignerCycle(
		e: Pox5RollupEventRow,
		staker: string,
		c: number,
		isStx: boolean,
		ctx: string,
	): void {
		const m = membership.get(key(staker, c));
		if (!m) {
			warn(e, `remove: no membership ${staker} c${c} (${ctx})`);
			return;
		}
		const { signer, amount } = m;
		const cur = g(signerDelegated, key(signer, c));
		const curStaked = g(signerShares, key(c, "none", signer));
		const tot = g(totalShares, key(c, "none"));
		const stakeAmt = isStx ? amount : 0n;
		const nd = cur - amount;
		if (inSet.has(key(signer, c))) {
			if (nd < MIN_SIGNER_USTX) {
				inSet.delete(key(signer, c));
				signerShares.set(key(c, "none", signer), 0n);
				totalShares.set(key(c, "none"), tot - curStaked);
			} else {
				totalShares.set(key(c, "none"), tot - stakeAmt);
				signerShares.set(key(c, "none", signer), curStaked - stakeAmt);
			}
		}
		membership.delete(key(staker, c));
		signerDelegated.set(key(signer, c), nd);
		stakerShares.delete(key(c, "none", staker, signer));
		signerPending.set(
			key(signer, c),
			g(signerPending, key(signer, c)) - stakeAmt,
		);
		ustxDelegated.set(c, g(ustxDelegated, c) - amount);
	}

	function addBondCycle(
		staker: string,
		signer: string,
		bond: number,
		c: number,
		sats: bigint,
	): void {
		totalShares.set(key(c, bond), g(totalShares, key(c, bond)) + sats);
		signerShares.set(
			key(c, bond, signer),
			g(signerShares, key(c, bond, signer)) + sats,
		);
		stakerShares.set(key(c, bond, staker, signer), sats);
	}

	/** Moves a bond staker's shares from one signer to another for one cycle,
	 *  without changing the bond's total (used by `update-bond-registration`,
	 *  which re-points an existing bond membership at a new signer). */
	function moveBondCycle(
		staker: string,
		oldSigner: string,
		newSigner: string,
		bond: number,
		c: number,
		sats: bigint,
	): void {
		signerShares.set(
			key(c, bond, oldSigner),
			g(signerShares, key(c, bond, oldSigner)) - sats,
		);
		signerShares.set(
			key(c, bond, newSigner),
			g(signerShares, key(c, bond, newSigner)) + sats,
		);
		stakerShares.delete(key(c, bond, staker, oldSigner));
		stakerShares.set(key(c, bond, staker, newSigner), sats);
	}

	const rewards: RewardEvent[] = [];

	for (const e of ordered) {
		maxBlockHeight = Math.max(maxBlockHeight, e.block_height);
		const d = tuple(e);
		const C = burnHeightToRewardCycle(e.burn_block_height, params);

		switch (e.topic) {
			case "stake": {
				const first = e.first_reward_cycle ?? 0;
				const num = numOf(d["num-cycles"]);
				const amt = bigOf(e.amount_ustx);
				if (first !== C + 1) {
					warn(e, `stake first ${first} != C+1 ${C + 1}`);
				}
				const staker = e.staker ?? "";
				const signer = e.signer ?? "";
				const old = bondMember.get(staker);
				if (old && !old.l1) totalSbtc -= old.sats; // roll-sbtc refund
				for (let i = 0; i < num; i++)
					addSignerCycle(staker, signer, first + i, amt, true);
				stakerInfo.set(staker, { amount: amt, first, num, signer });
				bondMember.delete(staker);
				break;
			}
			case "stake-update": {
				const staker = e.staker ?? "";
				const signer = e.signer ?? "";
				const info = stakerInfo.get(staker);
				if (!info) {
					warn(e, `stake-update without info ${staker}`);
					break;
				}
				const prevUnlock = info.first + info.num;
				if (prevUnlock !== numOf(d["prev-unlock-height"])) {
					warn(
						e,
						`prev-unlock mismatch ${staker} model ${prevUnlock} ev ${d["prev-unlock-height"]}`,
					);
				}
				const unlock = e.unlock_cycle ?? 0;
				const num = numOf(d["num-cycles"]);
				const first = unlock - num;
				if (first !== C + 1) {
					warn(e, `stake-update first ${first} != C+1 ${C + 1}`);
				}
				for (let c = first; c < prevUnlock; c++) {
					removeSignerCycle(e, staker, c, true, "stake-update");
				}
				const amt = bigOf(e.amount_ustx);
				for (let i = 0; i < num; i++)
					addSignerCycle(staker, signer, first + i, amt, true);
				stakerInfo.set(staker, {
					amount: amt,
					first: info.first,
					num: info.num + numOf(d["cycles-to-extend"]),
					signer,
				});
				break;
			}
			case "unstake": {
				const staker = e.staker ?? "";
				const info = stakerInfo.get(staker);
				if (!info) {
					warn(e, `unstake without info ${staker}`);
					break;
				}
				const prevUnlock = info.first + info.num;
				const unlock = e.unlock_cycle ?? 0;
				if (unlock !== C + 1) warn(e, `unstake unlock ${unlock} != C+1`);
				for (let c = unlock; c < prevUnlock; c++) {
					removeSignerCycle(e, staker, c, true, "unstake");
				}
				stakerInfo.set(staker, { ...info, num: unlock - info.first });
				break;
			}
			case "register-for-bond": {
				const staker = e.staker ?? "";
				const signer = e.signer ?? "";
				const bond = e.bond_index ?? 0;
				const first = e.first_reward_cycle ?? 0;
				const sats = bigOf(e.amount_sats);
				const l1 = e.is_l1_lock ?? false;
				const amtUstx = bigOf(e.amount_ustx);
				const old = bondMember.get(staker);
				const oldSbtc = old && !old.l1 ? old.sats : 0n;
				const newSbtc = l1 ? 0n : sats;
				totalSbtc += newSbtc - oldSbtc;
				bondMember.set(staker, { bond, amount: amtUstx, signer, l1, sats });
				bondTotal.set(bond, (bondTotal.get(bond) ?? 0n) + sats);
				for (let i = 0; i < BOND_LENGTH_CYCLES; i++) {
					addBondCycle(staker, signer, bond, first + i, sats);
				}
				for (let i = 0; i < BOND_LENGTH_CYCLES; i++) {
					addSignerCycle(staker, signer, first + i, amtUstx, false);
				}
				stakerInfo.delete(staker);
				break;
			}
			// UNPROVEN on mainnet — zero events observed. Ported from pox-5.clar
			// (stacks-core 4.0.1): re-points an existing bond membership at a new
			// signer-manager, moving both the STX-side delegation and the bond's
			// share ledger for the remaining cycles of the bond's window. The
			// bond's total size, sats, and l1 status are unchanged.
			case "update-bond-registration": {
				const staker = e.staker ?? "";
				const newSigner = e.signer ?? "";
				const bond = e.bond_index ?? 0;
				const first = e.first_reward_cycle ?? 0;
				const num = numOf(d["num-cycles"]);
				const amtUstx = bigOf(e.amount_ustx);
				const sats = bigOf(e.amount_sats);
				const old = bondMember.get(staker);
				const oldSigner = old?.signer ?? strOf(d["old-signer"]) ?? "";
				if (!old) {
					warn(e, `update-bond-registration without bond member ${staker}`);
					break;
				}
				for (let i = 0; i < num; i++) {
					const c = first + i;
					removeSignerCycle(e, staker, c, false, "update-bond-registration");
					addSignerCycle(staker, newSigner, c, amtUstx, false);
					moveBondCycle(staker, oldSigner, newSigner, bond, c, sats);
				}
				bondMember.set(staker, { ...old, signer: newSigner });
				break;
			}
			// UNPROVEN on mainnet — zero events observed. Ported from pox-5.clar
			// (stacks-core 4.0.1): fully releases an L1-locked bond's sats from
			// the current cycle (clamped to the bond's window) through the
			// bond's end, mirroring `unstake-sbtc` but a full exit (new sats = 0)
			// and never touching `totalSbtc` — L1 locks are never counted there.
			case "announce-l1-early-exit": {
				const staker = e.staker ?? "";
				const m = bondMember.get(staker);
				if (!m) {
					warn(e, `announce-l1-early-exit without bond member ${staker}`);
					break;
				}
				const bond = e.bond_index ?? m.bond;
				const bondStart = bondPeriodToRewardCycle(bond, params);
				const bondEnd = bondStart + BOND_WINDOW_CYCLES;
				const fc = clampCycle(C, bondStart, bondEnd);
				const w = bigOf(e.amount_sats); // amount-sats-released
				for (let c = fc; c < bondEnd; c++) {
					const sg = membership.get(key(staker, c))?.signer ?? m.signer;
					totalShares.set(key(c, bond), g(totalShares, key(c, bond)) - w);
					signerShares.set(
						key(c, bond, sg),
						g(signerShares, key(c, bond, sg)) - w,
					);
					stakerShares.set(key(c, bond, staker, sg), 0n);
				}
				m.sats = 0n;
				bondTotal.set(bond, (bondTotal.get(bond) ?? 0n) - w);
				break;
			}
			case "unstake-sbtc": {
				const staker = e.staker ?? "";
				const m = bondMember.get(staker);
				if (!m) {
					warn(e, `unstake-sbtc without bond member ${staker}`);
					break;
				}
				const bond = e.bond_index ?? m.bond;
				const bondStart = bondPeriodToRewardCycle(bond, params);
				const bondEnd = bondStart + BOND_WINDOW_CYCLES;
				const fc = clampCycle(C, bondStart, bondEnd);
				const w = bigOf(e.amount_sats); // amount-withdrawn-sats
				const ns = bigOf(d["new-amount-sats"]);
				for (let c = fc; c < bondEnd; c++) {
					const sg = membership.get(key(staker, c))?.signer ?? m.signer;
					totalShares.set(key(c, bond), g(totalShares, key(c, bond)) - w);
					signerShares.set(
						key(c, bond, sg),
						g(signerShares, key(c, bond, sg)) - w,
					);
					stakerShares.set(key(c, bond, staker, sg), ns);
				}
				m.sats = ns;
				bondTotal.set(bond, (bondTotal.get(bond) ?? 0n) - w);
				totalSbtc -= w;
				break;
			}
			case "calculate-rewards":
			case "bond-distribution":
			case "claim-rewards":
			case "claim-staker-rewards-for-signer":
				rewards.push({ topic: e.topic, tx_id: e.tx_id, e });
				break;
			// No effect on cycle state.
			case "set-bond-admin":
			case "set-pause-admin":
			case "pause-rewards":
			case "setup-bond":
			case "add-to-allowlist":
			case "register-signer":
			case "grant-signer-key":
			case "revoke-signer-grant":
				break;
		}
	}

	// ── Reward aggregation (two-pass: bond-distribution has no stx-cycle of
	// its own — it's printed inside the same tx as the calculate-rewards it
	// belongs to, so cycle-by-tx is resolved first). ──
	const cycleByTx = new Map<string, number>();
	for (const r of rewards) {
		if (r.topic !== "calculate-rewards") continue;
		cycleByTx.set(r.tx_id, numOf(tuple(r.e)["stx-cycle"]));
	}

	type CycleRewardAgg = {
		rewardsAllocatedStx: bigint;
		rewardsAllocatedBond: bigint;
		reserveDeposit: bigint;
		rewardsPerTokenStx: bigint | null;
		rewardsPerTokenBond: Map<number, bigint>;
		distributions: number;
		rewardsClaimed: bigint;
		rewardEligibleUstx: bigint | null;
	};
	const cycleRewards = new Map<number, CycleRewardAgg>();
	const emptyAgg = (): CycleRewardAgg => ({
		rewardsAllocatedStx: 0n,
		rewardsAllocatedBond: 0n,
		reserveDeposit: 0n,
		rewardsPerTokenStx: null,
		rewardsPerTokenBond: new Map(),
		distributions: 0,
		rewardsClaimed: 0n,
		rewardEligibleUstx: null,
	});
	const cycleAgg = (c: number): CycleRewardAgg => {
		let agg = cycleRewards.get(c);
		if (!agg) {
			agg = emptyAgg();
			cycleRewards.set(c, agg);
		}
		return agg;
	};
	const signerRewardsClaimed = new Map<string, bigint>(); // (signer|cycle)

	for (const r of rewards) {
		const d = tuple(r.e);
		switch (r.topic) {
			case "calculate-rewards": {
				const c = numOf(d["stx-cycle"]);
				const agg = cycleAgg(c);
				agg.rewardsAllocatedStx += bigOf(d["total-stx-staker-rewards"]);
				agg.reserveDeposit += bigOf(d["reserve-deposit"]);
				agg.rewardsPerTokenStx = bigOf(d["cumulative-rewards-per-ustx"]);
				agg.rewardEligibleUstx = bigOf(d["cycle-staked-ustx"]);
				agg.distributions += 1;
				break;
			}
			case "bond-distribution": {
				const c = cycleByTx.get(r.tx_id);
				if (c === undefined) {
					warn(
						r.e,
						`bond-distribution without a paired calculate-rewards ${r.tx_id}`,
					);
					break;
				}
				const bond = r.e.bond_index ?? numOf(d["bond-index"]);
				const agg = cycleAgg(c);
				agg.rewardsAllocatedBond += bigOf(d["bond-rewards"]);
				agg.rewardsPerTokenBond.set(
					bond,
					bigOf(d["cumulative-rewards-per-sat"]),
				);
				break;
			}
			case "claim-rewards": {
				const c = r.e.reward_cycle ?? numOf(d["reward-cycle"]);
				const signer = r.e.signer ?? "";
				const claimed = bigOf(d["total-rewards"]);
				cycleAgg(c).rewardsClaimed += claimed;
				signerRewardsClaimed.set(
					key(signer, c),
					(signerRewardsClaimed.get(key(signer, c)) ?? 0n) + claimed,
				);
				break;
			}
			case "claim-staker-rewards-for-signer": {
				const c = r.e.reward_cycle ?? numOf(d["reward-cycle"]);
				const signer = r.e.signer ?? "";
				const claimed = bigOf(d["rewards-claimed"]);
				cycleAgg(c).rewardsClaimed += claimed;
				signerRewardsClaimed.set(
					key(signer, c),
					(signerRewardsClaimed.get(key(signer, c)) ?? 0n) + claimed,
				);
				break;
			}
		}
	}

	// ── Build output rows from the final per-cycle state. ──
	const cycleSet = new Set<number>();
	for (const c of ustxDelegated.keys()) cycleSet.add(c);
	for (const c of cycleRewards.keys()) cycleSet.add(c);
	for (const k of totalShares.keys()) {
		const c = Number(k.split("|")[0]);
		if (Number.isFinite(c)) cycleSet.add(c);
	}
	for (const k of membership.keys()) {
		const c = Number(k.split("|")[1]);
		if (Number.isFinite(c)) cycleSet.add(c);
	}

	const stakersPerCycle = new Map<number, Set<string>>();
	for (const k of membership.keys()) {
		const [staker, cStr] = k.split("|");
		const c = Number(cStr);
		let set = stakersPerCycle.get(c);
		if (!set) {
			set = new Set();
			stakersPerCycle.set(c, set);
		}
		set.add(staker);
	}
	const signersInSetPerCycle = new Map<number, Set<string>>();
	for (const k of inSet) {
		const [signer, cStr] = k.split("|");
		const c = Number(cStr);
		let set = signersInSetPerCycle.get(c);
		if (!set) {
			set = new Set();
			signersInSetPerCycle.set(c, set);
		}
		set.add(signer);
	}
	const bondIndices = new Set<number>();
	for (const k of totalShares.keys()) {
		const bondPart = k.split("|")[1];
		if (bondPart !== "none") bondIndices.add(Number(bondPart));
	}

	const cycles: Pox5CycleRow[] = [...cycleSet]
		.sort((a, b) => a - b)
		.map((c) => {
			const agg = cycleRewards.get(c);
			const startBurnHeight = rewardCycleToBurnHeight(c, params);
			const endBurnHeight = rewardCycleToBurnHeight(c + 1, params) - 1;
			const bondSats: Record<string, string> = {};
			let bondTotalSats = 0n;
			for (const bond of bondIndices) {
				const shares = totalShares.get(key(c, bond));
				if (shares !== undefined) {
					bondSats[String(bond)] = shares.toString();
					bondTotalSats += shares;
				}
			}
			const rewardsPerTokenBond: Record<string, string> = {};
			for (const [bond, value] of agg?.rewardsPerTokenBond ?? []) {
				rewardsPerTokenBond[String(bond)] = value.toString();
			}
			return {
				reward_cycle: c,
				start_burn_height: startBurnHeight,
				prepare_start_burn_height: startBurnHeight - params.prepareCycleLength,
				end_burn_height: endBurnHeight,
				total_stacked_ustx: ustxDelegated.get(c) ?? 0n,
				reward_eligible_ustx:
					agg?.rewardEligibleUstx ?? g(totalShares, key(c, "none")),
				stakers: stakersPerCycle.get(c)?.size ?? 0,
				signers_in_set: signersInSetPerCycle.get(c)?.size ?? 0,
				bond_sats: bondSats,
				bond_total_sats: bondTotalSats,
				sbtc_custodied_sats: totalSbtc,
				rewards_allocated_stx: agg?.rewardsAllocatedStx ?? 0n,
				rewards_allocated_bond: agg?.rewardsAllocatedBond ?? 0n,
				reserve_deposit: agg?.reserveDeposit ?? 0n,
				rewards_per_token_stx: agg?.rewardsPerTokenStx ?? null,
				rewards_per_token_bond: rewardsPerTokenBond,
				distributions: agg?.distributions ?? 0,
				rewards_claimed: agg?.rewardsClaimed ?? 0n,
				computed_through_height: maxBlockHeight,
			};
		});

	const signers: Pox5CycleSignerRow[] = [];
	// A signer can have a claimed-rewards row with no live delegation this
	// cycle (e.g. claiming after their stake unlocked), so union in the
	// claim keys too rather than only the delegation maps.
	const signerCycleKeys = new Set<string>([
		...signerDelegated.keys(),
		...signerPending.keys(),
		...signerRewardsClaimed.keys(),
	]);
	for (const k of signerCycleKeys) {
		const [signer, cStr] = k.split("|");
		const c = Number(cStr);
		signers.push({
			reward_cycle: c,
			signer,
			delegated_ustx: g(signerDelegated, k),
			stx_only_ustx: g(signerPending, k),
			reward_shares_ustx: g(signerShares, key(c, "none", signer)),
			in_set: inSet.has(key(signer, c)),
			rewards_claimed: signerRewardsClaimed.get(key(signer, c)) ?? 0n,
		});
	}
	signers.sort((a, b) =>
		a.reward_cycle !== b.reward_cycle
			? a.reward_cycle - b.reward_cycle
			: a.signer.localeCompare(b.signer),
	);

	return { cycles, signers, warnings };
}
