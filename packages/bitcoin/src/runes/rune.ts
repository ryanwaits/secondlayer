// Ported from ord 0.29.0 `crates/ordinals/src/rune.rs`.

export enum Network {
	Bitcoin = "bitcoin",
	Testnet = "testnet",
	Signet = "signet",
	Regtest = "regtest",
}

/** Bitcoin's halving interval, in blocks. */
export const SUBSIDY_HALVING_INTERVAL = 210_000;

export interface Rune {
	n: bigint;
}

export function rune(n: bigint): Rune {
	return { n };
}

export const RUNE_RESERVED = 6402364363415443603228541259936211926n;

const UNLOCKED = 12;
const UNLOCK_INTERVAL = SUBSIDY_HALVING_INTERVAL / 12;

const STEPS: readonly bigint[] = [
	0n,
	26n,
	702n,
	18278n,
	475254n,
	12356630n,
	321272406n,
	8353082582n,
	217180147158n,
	5646683826134n,
	146813779479510n,
	3817158266467286n,
	99246114928149462n,
	2580398988131886038n,
	67090373691429037014n,
	1744349715977154962390n,
	45353092615406029022166n,
	1179180408000556754576342n,
	30658690608014475618984918n,
	797125955808376366093607894n,
	20725274851017785518433805270n,
	538857146126462423479278937046n,
	14010285799288023010461252363222n,
	364267430781488598271992561443798n,
	9470953200318703555071806597538774n,
	246244783208286292431866971536008150n,
	6402364363415443603228541259936211926n,
	166461473448801533683942072758341510102n,
];

const U32_MAX = 4_294_967_295n;

function saturatingAddU32(a: bigint, b: bigint): bigint {
	const sum = a + b;
	return sum > U32_MAX ? U32_MAX : sum;
}

function saturatingSubU32(a: bigint, b: bigint): bigint {
	return a < b ? 0n : a - b;
}

export function runeFirstHeight(network: Network): number {
	const multiplier =
		network === Network.Bitcoin ? 4 : network === Network.Testnet ? 12 : 0;
	return SUBSIDY_HALVING_INTERVAL * multiplier;
}

/** `height` is a block height (u32 range). Returns the minimum valid Rune at that height. */
export function runeMinimumAtHeight(network: Network, height: number): Rune {
	const offset = saturatingAddU32(BigInt(height), 1n);

	const start = BigInt(runeFirstHeight(network));
	const end = start + BigInt(SUBSIDY_HALVING_INTERVAL);

	if (offset < start) {
		return rune(STEPS[UNLOCKED] as bigint);
	}

	if (offset >= end) {
		return rune(0n);
	}

	const progress = saturatingSubU32(offset, start);

	const length = saturatingSubU32(
		BigInt(UNLOCKED),
		progress / BigInt(UNLOCK_INTERVAL),
	);

	const end2 = STEPS[Number(length) - 1] as bigint;
	const start2 = STEPS[Number(length)] as bigint;

	const remainder = progress % BigInt(UNLOCK_INTERVAL);

	return rune(start2 - ((start2 - end2) * remainder) / BigInt(UNLOCK_INTERVAL));
}

export function runeUnlockHeight(
	self: Rune,
	network: Network,
): number | undefined {
	if (runeIsReserved(self)) return undefined;

	if (self.n >= (STEPS[UNLOCKED] as bigint)) return 0;

	const i = STEPS.findIndex((step) => self.n < step);
	// biome-ignore lint/style/noNonNullAssertion: STEPS is exhaustive for any valid u128 Rune per ord's invariant
	const start = STEPS[i]!;
	const end = i > 0 ? (STEPS[i - 1] as bigint) : 0n;

	const interval = start - end;
	const progress = start - self.n;

	const height =
		BigInt(runeFirstHeight(network)) +
		BigInt(UNLOCKED - i) * BigInt(UNLOCK_INTERVAL) +
		(progress * BigInt(UNLOCK_INTERVAL) - 1n) / interval;

	return Number(height);
}

export function runeIsReserved(self: Rune): boolean {
	return self.n >= RUNE_RESERVED;
}

export function runeReserved(block: bigint, tx: bigint): Rune {
	return rune(RUNE_RESERVED + ((block << 32n) | tx));
}

/** Little-endian minimal byte encoding (trailing zero bytes trimmed), matching `Rune::commitment`. */
export function runeCommitment(self: Rune): Uint8Array {
	const out = new Uint8Array(16);
	let n = self.n;
	for (let i = 0; i < 16; i++) {
		out[i] = Number(n & 0xffn);
		n >>= 8n;
	}
	let end = 16;
	while (end > 0 && out[end - 1] === 0) end -= 1;
	return out.slice(0, end);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const U128_MAX = (1n << 128n) - 1n;

export function runeToString(self: Rune): string {
	let n = self.n;
	if (n === U128_MAX) {
		return "BCGDENLQRQWDSLRUGSNLBTMFIJAV";
	}

	n += 1n;
	let symbol = "";
	while (n > 0n) {
		symbol += ALPHABET[Number((n - 1n) % 26n)];
		n = (n - 1n) / 26n;
	}

	return symbol.split("").reverse().join("");
}

export class RuneParseError extends Error {
	constructor(
		readonly kind: "character" | "range",
		message: string,
	) {
		super(message);
		this.name = "RuneParseError";
	}
}

export function runeFromString(s: string): Rune {
	let x = 0n;
	for (let i = 0; i < s.length; i++) {
		const c = s[i] as string;
		if (i > 0) {
			x += 1n;
			if (x > U128_MAX) throw new RuneParseError("range", "name out of range");
		}
		x *= 26n;
		if (x > U128_MAX) throw new RuneParseError("range", "name out of range");
		if (c >= "A" && c <= "Z") {
			x += BigInt(c.charCodeAt(0) - "A".charCodeAt(0));
			if (x > U128_MAX) throw new RuneParseError("range", "name out of range");
		} else {
			throw new RuneParseError("character", `invalid character \`${c}\``);
		}
	}
	return rune(x);
}
