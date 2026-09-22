// Ported from ord 0.29.0 `crates/ordinals/src/etching.rs`.

import type { Rune } from "./rune.ts";
import type { Terms } from "./terms.ts";

export interface Etching {
	divisibility?: number;
	premine?: bigint;
	rune?: Rune;
	spacers?: number;
	symbol?: string;
	terms?: Terms;
	turbo: boolean;
}

export function defaultEtching(): Etching {
	return { turbo: false };
}

export const ETCHING_MAX_DIVISIBILITY = 38;
export const ETCHING_MAX_SPACERS = 0b00000111_11111111_11111111_11111111;

const U128_MAX = (1n << 128n) - 1n;

/** `Etching::supply` — `undefined` on overflow (`checked_add`/`checked_mul` failure), matching `Option<u128>`. */
export function etchingSupply(self: Etching): bigint | undefined {
	const premine = self.premine ?? 0n;
	const cap = self.terms?.cap ?? 0n;
	const amount = self.terms?.amount ?? 0n;

	const product = cap * amount;
	if (product > U128_MAX) return undefined; // checked_mul overflow

	const total = premine + product;
	if (total > U128_MAX) return undefined; // checked_add overflow

	return total;
}
