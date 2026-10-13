// Trusted starting point baked into each release. Everything verifyBlock
// proves is relative to it: a Stacks block whose state holds one cycle's
// signer set, and a Bitcoin header to sync proof-of-work from.
//
// Run `bun run --filter @secondlayer/verify rotate-checkpoint`; it proves the
// new checkpoint from this one.
import type { Checkpoint } from "./bitcoin/chain.ts";

export interface VerifyCheckpoint {
	stacks: {
		/** Raw Nakamoto header (hex) of a trusted block whose state holds `signerSet`. */
		header: string;
		/** Reward cycle `signerSet` belongs to. */
		cycle: number;
		/** `.signers` `cycle-signer-set[cycle]` as stored: hex of `(some (list ...))`. */
		signerSet: string;
	};
	/** Retarget-boundary Bitcoin header at or below the first burn block of `stacks.cycle`. */
	bitcoin: Checkpoint;
}

export { MAINNET_CHECKPOINT } from "./checkpoint-mainnet.ts";
