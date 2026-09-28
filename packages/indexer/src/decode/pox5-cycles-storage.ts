/**
 * Maintenance for the materialized pox-5 cycle rollup (`pox5_cycles` /
 * `pox5_cycle_signers`). Reads every canonical `pox5_events` row (joined to
 * `blocks` for `burn_block_height`, which `pox5_events` doesn't store),
 * replays it through the pure `rollupPox5Cycles`, and rewrites both tables
 * to match — a full recompute every time, not an incremental one (see the
 * maintenance note in plan 078: ~11k mainnet events replays in
 * milliseconds; only move to incremental if that ever exceeds 2s).
 */

import { getSourceDb, jsonb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import {
	type Pox5CycleParams,
	type Pox5RollupEventRow,
	rollupPox5Cycles,
} from "./pox5-cycles.ts";

// Mainnet PoX cycle math constants (genesis chain parameters from /v2/pox),
// mirroring the pox-4 decoder's own copy (`decoders/pox-4.ts`) — pox-5
// continues the same cycle numbering from Stacks genesis. Testnet is out of
// scope for v0.
const MAINNET_FIRST_BURNCHAIN_BLOCK_HEIGHT = 666_050;
const MAINNET_REWARD_CYCLE_LENGTH = 2_100;
const MAINNET_PREPARE_CYCLE_LENGTH = 100;

// `get-first-pox-5-reward-cycle` on mainnet, verified on the node at the
// epoch 4.0 fork (plan 078).
const MAINNET_FIRST_POX5_REWARD_CYCLE = 141;

export const MAINNET_POX5_CYCLE_PARAMS: Pox5CycleParams = {
	firstBurnchainBlockHeight: MAINNET_FIRST_BURNCHAIN_BLOCK_HEIGHT,
	rewardCycleLength: MAINNET_REWARD_CYCLE_LENGTH,
	prepareCycleLength: MAINNET_PREPARE_CYCLE_LENGTH,
	firstBondPeriodCycle: MAINNET_FIRST_POX5_REWARD_CYCLE,
};

function db(client?: Kysely<Database>): Kysely<Database> {
	return client ?? getSourceDb();
}

/** Every canonical `pox5_events` row, joined to `blocks` for the burn height
 *  the rollup needs, in canonical replay order. */
export async function readPox5RollupEvents(
	client?: Kysely<Database>,
): Promise<Pox5RollupEventRow[]> {
	const rows = await db(client)
		.selectFrom("pox5_events as e")
		.innerJoin("blocks as b", "b.height", "e.block_height")
		.where("e.canonical", "=", true)
		.where("b.canonical", "=", true)
		.select([
			"e.cursor",
			"e.block_height",
			"e.block_time",
			"e.tx_id",
			"e.tx_index",
			"e.event_index",
			"e.topic",
			"e.staker",
			"e.signer",
			"e.signer_manager",
			"e.bond_index",
			"e.amount_ustx",
			"e.amount_sats",
			"e.reward_cycle",
			"e.first_reward_cycle",
			"e.unlock_cycle",
			"e.unlock_burn_height",
			"e.is_l1_lock",
			"e.signer_key",
			"e.data",
			"e.source_cursor",
			"e.canonical",
			"b.burn_block_height",
		])
		.orderBy("e.block_height", "asc")
		.orderBy("e.tx_index", "asc")
		.orderBy("e.event_index", "asc")
		.execute();

	return rows.map((r) => ({
		cursor: r.cursor,
		block_height: r.block_height,
		block_time: r.block_time,
		tx_id: r.tx_id,
		tx_index: r.tx_index,
		event_index: r.event_index,
		topic: r.topic,
		staker: r.staker,
		signer: r.signer,
		signer_manager: r.signer_manager,
		bond_index: r.bond_index,
		amount_ustx: r.amount_ustx,
		amount_sats: r.amount_sats,
		reward_cycle: r.reward_cycle,
		first_reward_cycle: r.first_reward_cycle,
		unlock_cycle: r.unlock_cycle,
		unlock_burn_height: r.unlock_burn_height,
		is_l1_lock: r.is_l1_lock,
		signer_key: r.signer_key,
		data: r.data,
		source_cursor: r.source_cursor,
		canonical: r.canonical,
		burn_block_height: r.burn_block_height,
	}));
}

export type MaintainPox5CyclesResult = {
	cycles: number;
	signers: number;
	durationMs: number;
};

/**
 * Recomputes `pox5_cycles` / `pox5_cycle_signers` from ALL canonical
 * `pox5_events` and rewrites both tables to match, inside one transaction.
 * Call after a committed pox5 decoder batch and after `handlePox5Reorg`.
 */
export async function maintainPox5Cycles(opts?: {
	db?: Kysely<Database>;
	params?: Pox5CycleParams;
}): Promise<MaintainPox5CyclesResult> {
	const client = db(opts?.db);
	const params = opts?.params ?? MAINNET_POX5_CYCLE_PARAMS;
	const started = performance.now();

	const events = await readPox5RollupEvents(client);
	const { cycles, signers, warnings } = rollupPox5Cycles(events, params);

	for (const w of warnings) {
		logger.warn("pox5_cycles.rollup_warning", {
			message: w.message,
			cursor: w.cursor,
		});
	}

	// Callers sometimes hand us an already-open transaction (the pox5
	// decoder's own batch commit, `handlePox5Reorg` when called mid-reorg) —
	// Kysely refuses a nested `.transaction()` on a `Transaction`, so run
	// directly against it there instead of opening a second one.
	const run = client.isTransaction
		? (fn: (trx: Kysely<Database>) => Promise<void>) => fn(client)
		: (fn: (trx: Kysely<Database>) => Promise<void>) =>
				client.transaction().execute(fn);

	await run(async (trx) => {
		await trx.deleteFrom("pox5_cycle_signers").execute();
		await trx.deleteFrom("pox5_cycles").execute();

		if (cycles.length > 0) {
			await trx
				.insertInto("pox5_cycles")
				.values(
					cycles.map((c) => ({
						reward_cycle: c.reward_cycle,
						start_burn_height: c.start_burn_height,
						prepare_start_burn_height: c.prepare_start_burn_height,
						end_burn_height: c.end_burn_height,
						total_stacked_ustx: c.total_stacked_ustx.toString(),
						reward_eligible_ustx: c.reward_eligible_ustx.toString(),
						stakers: c.stakers,
						signers_in_set: c.signers_in_set,
						bond_sats: jsonb(c.bond_sats),
						bond_total_sats: c.bond_total_sats.toString(),
						sbtc_custodied_sats: c.sbtc_custodied_sats.toString(),
						rewards_allocated_stx: c.rewards_allocated_stx.toString(),
						rewards_allocated_bond: c.rewards_allocated_bond.toString(),
						reserve_deposit: c.reserve_deposit.toString(),
						rewards_per_token_stx: c.rewards_per_token_stx?.toString() ?? null,
						rewards_per_token_bond: jsonb(c.rewards_per_token_bond),
						distributions: c.distributions,
						rewards_claimed: c.rewards_claimed.toString(),
						computed_through_height: c.computed_through_height,
					})),
				)
				.execute();
		}

		if (signers.length > 0) {
			await trx
				.insertInto("pox5_cycle_signers")
				.values(
					signers.map((s) => ({
						reward_cycle: s.reward_cycle,
						signer: s.signer,
						delegated_ustx: s.delegated_ustx.toString(),
						stx_only_ustx: s.stx_only_ustx.toString(),
						reward_shares_ustx: s.reward_shares_ustx.toString(),
						in_set: s.in_set,
						rewards_claimed: s.rewards_claimed.toString(),
					})),
				)
				.execute();
		}
	});

	const durationMs = performance.now() - started;
	logger.info("pox5_cycles.maintained", {
		cycles: cycles.length,
		signers: signers.length,
		events: events.length,
		duration_ms: Math.round(durationMs),
	});
	if (durationMs > 2_000) {
		logger.warn("pox5_cycles.maintain_slow", {
			duration_ms: Math.round(durationMs),
			events: events.length,
		});
	}

	return { cycles: cycles.length, signers: signers.length, durationMs };
}
