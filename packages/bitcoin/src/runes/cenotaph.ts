// Ported from ord 0.29.0 `crates/ordinals/src/cenotaph.rs`.

import type { Flaw } from "./flaw.ts";
import type { Rune } from "./rune.ts";
import type { RuneId } from "./rune_id.ts";

export interface Cenotaph {
	etching?: Rune;
	flaw?: Flaw;
	mint?: RuneId;
}

export function defaultCenotaph(): Cenotaph {
	return {};
}
