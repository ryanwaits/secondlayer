/**
 * A minimal recursive-descent JSON parser that keeps every integer literal as
 * a `bigint` instead of a `number`.
 *
 * Why this exists: ord's `/decode` JSON (and its `runes`/`balances` CLI JSON)
 * serialize u128 fields (premine, cap, amount, ...) as bare numeric literals,
 * not quoted strings — e.g. `"premine":21000000000000000000000000000`
 * (confirmed live against ord 0.29.0 at `/decode/{txid}`, THERUNIXTOKEN
 * etching, block 840,000). `JSON.parse` converts that literal to a `number`
 * and silently loses precision past 2^53. Parity comparisons on those fields
 * would then pass or fail on rounding artifacts instead of real divergence —
 * exactly the class of bug the plan's "never go through Number for u128" rule
 * exists to prevent. This parser is the one place ord's JSON is read, so that
 * rule holds for parity data too, not just our own decoder.
 */

export type JsonBigIntValue =
	| null
	| boolean
	| string
	| bigint
	| number
	| JsonBigIntValue[]
	| { [key: string]: JsonBigIntValue };

export class JsonParseError extends Error {
	constructor(
		message: string,
		readonly position: number,
	) {
		super(`${message} at position ${position}`);
		this.name = "JsonParseError";
	}
}

export function parseJsonPreservingBigInts(text: string): JsonBigIntValue {
	let i = 0;

	function isWhitespace(c: string): boolean {
		return c === " " || c === "\t" || c === "\n" || c === "\r";
	}

	function skipWs(): void {
		while (i < text.length && isWhitespace(text[i] as string)) i++;
	}

	function expectChar(c: string): void {
		if (text[i] !== c) {
			throw new JsonParseError(`expected '${c}'`, i);
		}
		i++;
	}

	function expectLiteral(literal: string): void {
		if (text.slice(i, i + literal.length) !== literal) {
			throw new JsonParseError(`expected '${literal}'`, i);
		}
		i += literal.length;
	}

	function parseString(): string {
		expectChar('"');
		let out = "";
		while (true) {
			if (i >= text.length) throw new JsonParseError("unterminated string", i);
			const c = text[i] as string;
			if (c === '"') {
				i++;
				return out;
			}
			if (c === "\\") {
				i++;
				const esc = text[i];
				switch (esc) {
					case '"':
						out += '"';
						break;
					case "\\":
						out += "\\";
						break;
					case "/":
						out += "/";
						break;
					case "b":
						out += "\b";
						break;
					case "f":
						out += "\f";
						break;
					case "n":
						out += "\n";
						break;
					case "r":
						out += "\r";
						break;
					case "t":
						out += "\t";
						break;
					case "u": {
						const hex = text.slice(i + 1, i + 5);
						out += String.fromCharCode(Number.parseInt(hex, 16));
						i += 4;
						break;
					}
					default:
						throw new JsonParseError(`invalid escape '\\${esc}'`, i);
				}
				i++;
			} else {
				out += c;
				i++;
			}
		}
	}

	function parseNumber(): bigint | number {
		const start = i;
		if (text[i] === "-") i++;
		while (i < text.length && text[i] >= "0" && text[i] <= "9") i++;
		let isFloat = false;
		if (text[i] === ".") {
			isFloat = true;
			i++;
			while (i < text.length && text[i] >= "0" && text[i] <= "9") i++;
		}
		if (text[i] === "e" || text[i] === "E") {
			isFloat = true;
			i++;
			if (text[i] === "+" || text[i] === "-") i++;
			while (i < text.length && text[i] >= "0" && text[i] <= "9") i++;
		}
		const literal = text.slice(start, i);
		if (literal.length === 0 || literal === "-") {
			throw new JsonParseError("invalid number", start);
		}
		// ord never emits fractional u128 fields, but tolerate a float literal
		// (e.g. a future non-integer field) rather than crash on it.
		return isFloat ? Number.parseFloat(literal) : BigInt(literal);
	}

	function parseArray(): JsonBigIntValue[] {
		expectChar("[");
		skipWs();
		const out: JsonBigIntValue[] = [];
		if (text[i] === "]") {
			i++;
			return out;
		}
		while (true) {
			skipWs();
			out.push(parseValue());
			skipWs();
			if (text[i] === ",") {
				i++;
				continue;
			}
			expectChar("]");
			return out;
		}
	}

	function parseObject(): { [key: string]: JsonBigIntValue } {
		expectChar("{");
		skipWs();
		const out: { [key: string]: JsonBigIntValue } = {};
		if (text[i] === "}") {
			i++;
			return out;
		}
		while (true) {
			skipWs();
			const key = parseString();
			skipWs();
			expectChar(":");
			skipWs();
			out[key] = parseValue();
			skipWs();
			if (text[i] === ",") {
				i++;
				continue;
			}
			expectChar("}");
			return out;
		}
	}

	function parseValue(): JsonBigIntValue {
		skipWs();
		const c = text[i];
		if (c === '"') return parseString();
		if (c === "{") return parseObject();
		if (c === "[") return parseArray();
		if (c === "t") {
			expectLiteral("true");
			return true;
		}
		if (c === "f") {
			expectLiteral("false");
			return false;
		}
		if (c === "n") {
			expectLiteral("null");
			return null;
		}
		return parseNumber();
	}

	const result = parseValue();
	skipWs();
	if (i !== text.length) {
		throw new JsonParseError("trailing content after JSON value", i);
	}
	return result;
}

// Small type-narrowing helpers for callers walking the untyped tree.
export function asObject(
	v: JsonBigIntValue,
): { [key: string]: JsonBigIntValue } | undefined {
	return v !== null && typeof v === "object" && !Array.isArray(v)
		? (v as { [key: string]: JsonBigIntValue })
		: undefined;
}
export function asArray(v: JsonBigIntValue): JsonBigIntValue[] | undefined {
	return Array.isArray(v) ? v : undefined;
}
export function asString(v: JsonBigIntValue): string | undefined {
	return typeof v === "string" ? v : undefined;
}
export function asBigInt(v: JsonBigIntValue): bigint | undefined {
	return typeof v === "bigint" ? v : undefined;
}
