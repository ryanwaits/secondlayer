// Ported from ord 0.29.0 `crates/ordinals/src/runestone/flag.rs`.

export enum Flag {
	Etching = 0,
	Terms = 1,
	Turbo = 2,
	Cenotaph = 127,
}

export function flagMask(flag: Flag): bigint {
	return 1n << BigInt(flag);
}

/** Mutable flags box — stands in for Rust's `&mut u128`. */
export interface FlagsRef {
	value: bigint;
}

export function flagTake(flag: Flag, flags: FlagsRef): boolean {
	const mask = flagMask(flag);
	const set = (flags.value & mask) !== 0n;
	flags.value &= ~mask;
	return set;
}

export function flagSet(flag: Flag, flags: FlagsRef): void {
	flags.value |= flagMask(flag);
}
