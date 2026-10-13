/**
 * Verify-checkpoint guard.
 *
 * @secondlayer/verify proves every block forward from MAINNET_CHECKPOINT, so
 * each reward cycle it falls behind adds a signer-set walk to every check.
 * This guard estimates the chain's current cycle offline from the checkpoint's
 * Bitcoin header time (one block per ~600 s) and fails the release when the
 * checkpoint is more than 3 cycles (~6 weeks) behind.
 *
 * Chained onto the `version` script. Fix with:
 *   bun run --filter @secondlayer/verify rotate-checkpoint
 *
 * FAKE_NOW (Unix seconds) replaces the clock. It exists only to test the
 * failing path; never set it in CI.
 *
 * Usage: bun run scripts/ci/check-verify-checkpoint.ts
 */
import { parseHeader } from "../../packages/verify/src/bitcoin/header.ts";
import {
	MAINNET_FIRST_BURN_HEIGHT,
	MAINNET_REWARD_CYCLE_LENGTH,
} from "../../packages/verify/src/burn.ts";
import { MAINNET_CHECKPOINT as cp } from "../../packages/verify/src/checkpoint.ts";

const MAX_CYCLES_BEHIND = 3;
const BLOCK_SECONDS = 600;

const now = process.env.FAKE_NOW
	? Number(process.env.FAKE_NOW)
	: Date.now() / 1000;
const checkpointTime = parseHeader(cp.bitcoin.header).time;
const height = cp.bitcoin.height + (now - checkpointTime) / BLOCK_SECONDS;
const current = Math.floor(
	(height - MAINNET_FIRST_BURN_HEIGHT) / MAINNET_REWARD_CYCLE_LENGTH,
);

if (current - cp.stacks.cycle > MAX_CYCLES_BEHIND) {
	console.error(
		`verify checkpoint is cycle ${cp.stacks.cycle}, chain is ~cycle ${current}: run bun run --filter @secondlayer/verify rotate-checkpoint`,
	);
	process.exit(1);
}
console.log(
	`Verify checkpoint is cycle ${cp.stacks.cycle}, chain is ~cycle ${current}.`,
);
