import {
	asciiToBytes,
	bytesToAscii,
	hexToBytes,
	utf8ToBytes,
} from "../utils/encoding.ts";
import type { ClarityValue } from "./types.ts";

export function prettyPrint(
	val: ClarityValue,
	encoding: "tryAscii" | "hex" = "hex",
): string | undefined {
	switch (val.type) {
		case "true":
			return "true";
		case "false":
			return "false";
		case "int":
			return val.value.toString();
		case "uint":
			return `u${val.value.toString()}`;
		case "buffer":
			if (encoding === "tryAscii") {
				const str = bytesToAscii(hexToBytes(val.value));
				if (/^[ -~]*$/.test(str)) return JSON.stringify(str);
			}
			return `0x${val.value}`;
		case "none":
			return "none";
		case "some":
			return `(some ${prettyPrint(val.value, encoding)})`;
		case "ok":
			return `(ok ${prettyPrint(val.value, encoding)})`;
		case "err":
			return `(err ${prettyPrint(val.value, encoding)})`;
		case "address":
		case "contract":
			return val.value;
		case "list":
			return `(list ${val.value.map((v) => prettyPrint(v, encoding)).join(" ")})`;
		case "tuple":
			return `(tuple ${Object.keys(val.value)
				// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
				.map((key) => `(${key} ${prettyPrint(val.value[key]!, encoding)})`)
				.join(" ")})`;
		case "ascii":
			return `"${val.value}"`;
		case "utf8":
			return `u"${val.value}"`;
	}
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export function cvToJSON(val: ClarityValue): any {
	switch (val.type) {
		case "true":
			return { type: "bool", value: true };
		case "false":
			return { type: "bool", value: false };
		case "int":
			return { type: "int", value: val.value.toString() };
		case "uint":
			return { type: "uint", value: val.value.toString() };
		case "buffer":
			return {
				type: `(buff ${Math.ceil(val.value.length / 2)})`,
				value: `0x${val.value}`,
			};
		case "none":
			return { type: "(optional none)", value: null };
		case "some":
			return { type: "(optional)", value: cvToJSON(val.value) };
		case "ok":
			return { type: "(response)", value: cvToJSON(val.value), success: true };
		case "err":
			return { type: "(response)", value: cvToJSON(val.value), success: false };
		case "address":
		case "contract":
			return { type: "principal", value: val.value };
		case "list":
			return { type: "(list)", value: val.value.map(cvToJSON) };
		case "tuple": {
			// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
			const result: Record<string, any> = {};
			for (const key of Object.keys(val.value)) {
				// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
				result[key] = cvToJSON(val.value[key]!);
			}
			return { type: "(tuple)", value: result };
		}
		case "ascii":
			return {
				type: `(string-ascii ${asciiToBytes(val.value).length})`,
				value: val.value,
			};
		case "utf8":
			return {
				type: `(string-utf8 ${utf8ToBytes(val.value).length})`,
				value: val.value,
			};
	}
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export function cvToValue(val: ClarityValue): any {
	switch (val.type) {
		case "true":
			return true;
		case "false":
			return false;
		case "int":
		case "uint":
			return val.value;
		case "buffer":
			return `0x${val.value}`;
		case "none":
			return null;
		case "some":
			return cvToValue(val.value);
		case "ok":
		case "err":
			return cvToValue(val.value);
		case "address":
		case "contract":
			return val.value;
		case "list":
			return val.value.map(cvToValue);
		case "tuple": {
			// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
			const result: Record<string, any> = {};
			for (const key of Object.keys(val.value)) {
				// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
				result[key] = cvToValue(val.value[key]!);
			}
			return result;
		}
		case "ascii":
		case "utf8":
			return val.value;
	}
}

/** Narrow to bigint; throws unless `val` is an int or uint. */
export function cvToBigInt(val: ClarityValue): bigint {
	if (val.type !== "int" && val.type !== "uint") {
		throw new Error(`cvToBigInt: expected int or uint, got ${val.type}`);
	}
	return val.value;
}

/** Narrow to string; throws unless `val` is an ascii or utf8 string. */
export function cvToString(val: ClarityValue): string {
	if (val.type !== "ascii" && val.type !== "utf8") {
		throw new Error(`cvToString: expected ascii or utf8, got ${val.type}`);
	}
	return val.value;
}

/** Narrow to hex string (no 0x prefix); throws unless `val` is a buffer. */
export function cvToBuffer(val: ClarityValue): string {
	if (val.type !== "buffer") {
		throw new Error(`cvToBuffer: expected buffer, got ${val.type}`);
	}
	return val.value;
}

/** Narrow to boolean; throws unless `val` is a bool. */
export function cvToBoolean(val: ClarityValue): boolean {
	if (val.type !== "true" && val.type !== "false") {
		throw new Error(`cvToBoolean: expected bool, got ${val.type}`);
	}
	return val.type === "true";
}

/** Narrow to principal string; throws unless `val` is a standard or contract principal. */
export function cvToPrincipal(val: ClarityValue): string {
	if (val.type !== "address" && val.type !== "contract") {
		throw new Error(
			`cvToPrincipal: expected principal or contract, got ${val.type}`,
		);
	}
	return val.value;
}
