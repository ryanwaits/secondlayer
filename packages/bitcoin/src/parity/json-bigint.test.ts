import { describe, expect, test } from "bun:test";
import { parseJsonPreservingBigInts } from "./json-bigint.ts";

describe("parseJsonPreservingBigInts", () => {
	test("keeps a u128-scale integer literal exact", () => {
		// The real THERUNIXTOKEN premine value seen live from ord 0.29.0's /decode.
		const json = '{"premine":21000000000000000000000000000}';
		const result = parseJsonPreservingBigInts(json) as { premine: bigint };
		expect(result.premine).toBe(21000000000000000000000000000n);
	});

	test("parses nested objects, arrays, strings, booleans, and null", () => {
		const json = `{
			"a": [1, 2, 3],
			"b": {"c": null, "d": true, "e": false},
			"f": "hello \\"world\\"",
			"g": null
		}`;
		expect(parseJsonPreservingBigInts(json)).toEqual({
			a: [1n, 2n, 3n],
			b: { c: null, d: true, e: false },
			f: 'hello "world"',
			g: null,
		});
	});

	test("decodes unicode escapes (e.g. rune symbols)", () => {
		const json = '{"symbol":"\\u16a0"}';
		expect(parseJsonPreservingBigInts(json)).toEqual({ symbol: "ᚠ" });
	});

	test("decodes a surrogate pair (emoji symbol)", () => {
		const json = '{"symbol":"\\ud83d\\udc15"}';
		const result = parseJsonPreservingBigInts(json) as { symbol: string };
		expect(result.symbol).toBe("🐕");
	});

	test("parses a negative integer", () => {
		expect(parseJsonPreservingBigInts("-42")).toBe(-42n);
	});

	test("throws on trailing garbage", () => {
		expect(() => parseJsonPreservingBigInts("{}garbage")).toThrow();
	});

	test("matches JSON.parse on a full real /decode response shape", () => {
		const json = JSON.stringify({
			inscriptions: [],
			runestone: {
				Runestone: {
					edicts: [],
					etching: {
						divisibility: 2,
						premine: 11000000000,
						rune: "ZZZZZFEHUZZZZZ",
						spacers: 7967,
						symbol: "ᚠ",
						terms: {
							amount: 100,
							cap: 1111111,
							height: [null, null],
							offset: [null, null],
						},
						turbo: true,
					},
					mint: null,
					pointer: null,
				},
			},
		});
		const parsed = parseJsonPreservingBigInts(json) as {
			runestone: { Runestone: { etching: { premine: bigint; rune: string } } };
		};
		expect(parsed.runestone.Runestone.etching.premine).toBe(11000000000n);
		expect(parsed.runestone.Runestone.etching.rune).toBe("ZZZZZFEHUZZZZZ");
	});
});
