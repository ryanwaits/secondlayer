// Ported from ord 0.29.0 `crates/ordinals/src/artifact.rs`.

import type { Cenotaph } from "./cenotaph.ts";
import type { RuneId } from "./rune_id.ts";
import type { Runestone } from "./runestone.ts";

export type Artifact =
	| { type: "cenotaph"; cenotaph: Cenotaph }
	| { type: "runestone"; runestone: Runestone };

export function artifactCenotaph(cenotaph: Cenotaph): Artifact {
	return { type: "cenotaph", cenotaph };
}

export function artifactRunestone(runestone: Runestone): Artifact {
	return { type: "runestone", runestone };
}

export function artifactMint(artifact: Artifact): RuneId | undefined {
	return artifact.type === "cenotaph"
		? artifact.cenotaph.mint
		: artifact.runestone.mint;
}
