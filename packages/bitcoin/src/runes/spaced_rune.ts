// Ported from ord 0.29.0 `crates/ordinals/src/spaced_rune.rs`.

import {
	type Rune,
	RuneParseError,
	runeFromString,
	runeToString,
} from "./rune.ts";

export interface SpacedRune {
	rune: Rune;
	spacers: number;
}

export function spacedRune(rune: Rune, spacers: number): SpacedRune {
	return { rune, spacers };
}

export class SpacedRuneParseError extends Error {
	constructor(
		readonly kind:
			| "leading-spacer"
			| "trailing-spacer"
			| "double-spacer"
			| "character"
			| "rune",
		message: string,
	) {
		super(message);
		this.name = "SpacedRuneParseError";
	}
}

function leadingZeros32(n: number): number {
	if (n === 0) return 32;
	let count = 0;
	let v = n >>> 0;
	while ((v & 0x80000000) === 0) {
		v <<= 1;
		count++;
	}
	return count;
}

export function spacedRuneFromString(s: string): SpacedRune {
	let runeName = "";
	let spacers = 0;

	for (const c of s) {
		if (c >= "A" && c <= "Z") {
			runeName += c;
		} else if (c === "." || c === "•") {
			if (runeName.length === 0) {
				throw new SpacedRuneParseError("leading-spacer", "leading spacer");
			}
			const flag = 1 << (runeName.length - 1);
			if ((spacers & flag) !== 0) {
				throw new SpacedRuneParseError("double-spacer", "double spacer");
			}
			spacers |= flag;
		} else {
			throw new SpacedRuneParseError("character", `invalid character \`${c}\``);
		}
	}

	if (32 - leadingZeros32(spacers) >= runeName.length) {
		throw new SpacedRuneParseError("trailing-spacer", "trailing spacer");
	}

	let rune: Rune;
	try {
		rune = runeFromString(runeName);
	} catch (e) {
		if (e instanceof RuneParseError) {
			throw new SpacedRuneParseError("rune", e.message);
		}
		throw e;
	}

	return { rune, spacers };
}

export function spacedRuneToString(self: SpacedRune): string {
	const runeStr = runeToString(self.rune);
	let out = "";
	for (let i = 0; i < runeStr.length; i++) {
		out += runeStr[i];
		if (i < runeStr.length - 1 && (self.spacers & (1 << i)) !== 0) {
			out += "•";
		}
	}
	return out;
}
