/**
 * Keeps the verify checkpoint fresh at release time.
 *
 * @secondlayer/verify proves every block forward from MAINNET_CHECKPOINT, so
 * each reward cycle it falls behind adds a signer-set walk to every check, and
 * users only get a new checkpoint in a new release. This step estimates the
 * chain's cycle offline from the checkpoint's Bitcoin header time (one block
 * per ~600 s). More than 3 cycles (~6 weeks) behind, it rotates the checkpoint,
 * proving the new one from the old, and writes a changeset so @secondlayer/verify
 * ships it. A failed rotation fails the release.
 *
 * Runs first in the `version` script, so `changeset version` consumes the
 * changeset.
 *
 * FAKE_NOW (Unix seconds) replaces the clock. It exists only to test rotation;
 * never set it in CI.
 *
 * Usage: bun run scripts/ci/rotate-verify-checkpoint.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseHeader } from "../../packages/verify/src/bitcoin/header.ts";
import {
	MAINNET_FIRST_BURN_HEIGHT,
	MAINNET_REWARD_CYCLE_LENGTH,
} from "../../packages/verify/src/burn.ts";
import { MAINNET_CHECKPOINT as cp } from "../../packages/verify/src/checkpoint.ts";

const MAX_CYCLES_BEHIND = 3;
const BLOCK_SECONDS = 600;
const ROOT = join(import.meta.dir, "../..");
const CHECKPOINT_FILE = join(ROOT, "packages/verify/src/checkpoint-mainnet.ts");

const now = process.env.FAKE_NOW
	? Number(process.env.FAKE_NOW)
	: Date.now() / 1000;
const checkpointTime = parseHeader(cp.bitcoin.header).time;
const height = cp.bitcoin.height + (now - checkpointTime) / BLOCK_SECONDS;
const current = Math.floor(
	(height - MAINNET_FIRST_BURN_HEIGHT) / MAINNET_REWARD_CYCLE_LENGTH,
);

if (current - cp.stacks.cycle <= MAX_CYCLES_BEHIND) {
	console.log(
		`Verify checkpoint is cycle ${cp.stacks.cycle}, chain is ~cycle ${current}.`,
	);
	process.exit(0);
}

console.log(
	`Verify checkpoint is cycle ${cp.stacks.cycle}, chain is ~cycle ${current}: rotating.`,
);
const rotation = Bun.spawnSync(
	["bun", "run", "--filter", "@secondlayer/verify", "rotate-checkpoint"],
	{ cwd: ROOT, stdout: "inherit", stderr: "inherit" },
);
if (rotation.exitCode !== 0) {
	console.error(
		"verify checkpoint rotation failed: fix the cause and rerun bun run version",
	);
	process.exit(1);
}

const cycle = readFileSync(CHECKPOINT_FILE, "utf8").match(
	/\bcycle: (\d+),/,
)?.[1];
if (!cycle) {
	console.error(`no cycle found in ${CHECKPOINT_FILE}`);
	process.exit(1);
}
if (Number(cycle) === cp.stacks.cycle) process.exit(0);

writeFileSync(
	join(ROOT, `.changeset/verify-checkpoint-cycle-${cycle}.md`),
	`---
"@secondlayer/verify": patch
---

Move the built-in checkpoint to cycle ${cycle}, proven from cycle ${cp.stacks.cycle}.
`,
);
console.log(`Verify checkpoint rotated to cycle ${cycle}.`);
