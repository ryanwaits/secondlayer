/**
 * Format a bigint value with decimal places.
 * @example formatUnits(1000000n, 6) → "1.0"
 * @example formatUnits(1500000n, 6) → "1.5"
 */
export function formatUnits(
	value: bigint | number | string,
	decimals: number,
): string {
	let v = BigInt(value);

	const negative = v < 0n;
	if (negative) v = -v;

	const divisor = 10n ** BigInt(decimals);
	const integer = (v / divisor).toString();
	let fraction = (v % divisor).toString().padStart(decimals, "0");

	// Trim trailing zeros, but keep at least one decimal
	fraction = fraction.replace(/0+$/, "") || "0";

	const result = `${integer}.${fraction}`;
	return negative ? `-${result}` : result;
}

/**
 * Parse a decimal string into a bigint with the given number of decimals.
 * @example parseUnits("1.5", 6) → 1500000n
 * @example parseUnits("1", 6) → 1000000n
 */
const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

export function parseUnits(value: string | number, decimals: number): bigint {
	if (typeof value === "number" && !Number.isFinite(value)) {
		throw new RangeError(`Cannot parse ${value} as a decimal amount`);
	}
	// Numbers small or large enough to print in exponent form (1e-7, 1e21)
	// go through toFixed so the digits survive. A number the fixed form
	// cannot hold exactly (too many decimals, or too small for one unit) is
	// refused rather than rounded, so amounts never shrink silently.
	let str = typeof value === "number" ? value.toFixed(decimals) : value.trim();
	if (!DECIMAL_STRING.test(str)) {
		throw new RangeError(
			`Cannot parse "${value}" as a decimal amount: expected digits with an optional fraction, like "1.5"`,
		);
	}
	if (typeof value === "number" && Number(str) !== value) {
		throw new RangeError(
			`Cannot parse ${value} with ${decimals} decimals: pass the amount as a string to keep every digit`,
		);
	}

	const negative = str.startsWith("-");
	if (negative) str = str.slice(1);

	const [integer = "", fraction = ""] = str.split(".");

	if (fraction.length > decimals) {
		throw new Error(
			`Too many decimal places: "${value}" has ${fraction.length} decimals, max is ${decimals}`,
		);
	}

	const padded = fraction.padEnd(decimals, "0");
	const result = BigInt(integer + padded);
	return negative ? -result : result;
}

/**
 * Format microSTX to STX string (6 decimals).
 * @example formatStx(1000000n) → "1.0"
 */
export function formatStx(microStx: bigint | number | string): string {
	return formatUnits(microStx, 6);
}

/**
 * Parse STX string to microSTX bigint (6 decimals).
 * @example parseStx("1.5") → 1500000n
 */
export function parseStx(stx: string | number): bigint {
	return parseUnits(stx, 6);
}
