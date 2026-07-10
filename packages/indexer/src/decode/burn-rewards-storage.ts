import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import type { NewBurnBlockPayload } from "../types/node-events.ts";

function db(client?: Kysely<Database>): Kysely<Database> {
	return client ?? getSourceDb();
}

let innerKeysVerified = false;

/**
 * Persist the PoX reward data from a /new_burn_block event observer payload.
 *
 * Both tables are rewritten per burn-block-height (delete-then-insert in one
 * tx). Replace-per-height IS the burnchain reorg contract (plan f062): it
 * heals event redelivery and burnchain reorgs of ANY depth height-by-height,
 * because stacks-core re-announces /new_burn_block for every replaced height
 * when it processes a burnchain fork (the nakamoto coordinator runs every
 * newly-canonical burn block lacking a sortition through evaluate_sortition,
 * which fires dispatcher_announce_burn_ops; the announce_burn_block trait doc
 * says explicitly it fires multiple times per header hash across forks).
 *
 * Accepted residual gaps, by design: during a depth-d reorg there is a
 * mixed-fork read window (heights not yet redelivered still show the old
 * fork) with no detection signal — chain_reorgs is Stacks-level; consumers
 * needing fork consistency must cross-check burn_block_hash linkage. A
 * replacement fork with fewer blocks (essentially impossible outside a
 * difficulty-retarget boundary) leaves rows above the new tip stale until
 * the chain re-reaches that height. There is no orphan history: replaced
 * rows are gone, not archived.
 *
 * Recipients map positionally to reward slots (reward_index 0/1 — at most
 * two per block).
 */
export async function persistBurnBlockRewards(
	payload: NewBurnBlockPayload,
	opts?: { db?: Kysely<Database> },
): Promise<{ rewards: number; slots: number }> {
	const height = payload.burn_block_height;
	const hash = payload.burn_block_hash;
	const recipients = payload.reward_recipients ?? [];
	const slots = payload.reward_slot_holders ?? [];

	// We couldn't capture a populated reward_recipients in the field (our sample
	// landed in a prepare phase). Assert the inner key names on the first real
	// payout so a node-version shape drift surfaces loudly instead of writing nulls.
	if (!innerKeysVerified && recipients.length > 0) {
		const r = recipients[0];
		if (typeof r.recipient !== "string" || typeof r.amt !== "number") {
			logger.error("Unexpected reward_recipients shape", { sample: r });
		}
		innerKeysVerified = true;
	}

	await db(opts?.db)
		.transaction()
		.execute(async (trx) => {
			await trx
				.deleteFrom("burn_block_rewards")
				.where("burn_block_height", "=", height)
				.execute();
			await trx
				.deleteFrom("burn_block_reward_slots")
				.where("burn_block_height", "=", height)
				.execute();

			if (recipients.length > 0) {
				await trx
					.insertInto("burn_block_rewards")
					.values(
						recipients.map((r, i) => ({
							cursor: `${height}:${i}`,
							burn_block_height: height,
							burn_block_hash: hash,
							reward_index: i,
							recipient_btc: r.recipient,
							amount_sats: String(r.amt),
							burn_amount: String(payload.burn_amount ?? 0),
						})),
					)
					.execute();
			}

			if (slots.length > 0) {
				await trx
					.insertInto("burn_block_reward_slots")
					.values(
						slots.map((holder, i) => ({
							cursor: `${height}:${i}`,
							burn_block_height: height,
							burn_block_hash: hash,
							slot_index: i,
							holder_btc: holder,
						})),
					)
					.execute();
			}
		});

	return { rewards: recipients.length, slots: slots.length };
}
