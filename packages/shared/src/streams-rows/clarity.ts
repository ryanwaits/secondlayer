import { cvToValue, deserializeCV } from "@secondlayer/stacks/clarity";

/** Make a cvToValue result JSON-serializable: Clarity (u)ints decode to bigint,
 *  which JSON.stringify can't handle — convert recursively to strings. */
export function toJsonSafe(value: unknown): unknown {
	if (typeof value === "bigint") return value.toString();
	if (Array.isArray(value)) return value.map(toJsonSafe);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) {
			out[key] = toJsonSafe(val);
		}
		return out;
	}
	return value;
}

/** Decode a hex-encoded Clarity value to JSON-safe JS (uints as strings,
 *  buffers as `0x…` hex, tuples as objects). Returns the input hex on failure. */
export function decodeClarityValue(hex: string): unknown {
	try {
		const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
		return toJsonSafe(cvToValue(deserializeCV(clean)));
	} catch {
		return hex;
	}
}
