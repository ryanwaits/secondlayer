import { describe, expect, test } from "bun:test";
import {
	bodyFromText,
	canonicalJson,
	parseObserverBody,
	semanticObserverSha256,
	sha256Hex,
} from "./observer-journal.ts";

describe("observer journal encoding", () => {
	test("canonical JSON sorts object keys but preserves array order", () => {
		expect(
			canonicalJson({ z: 1, nested: { b: true, a: null }, a: [2, 1] }),
		).toBe('{"a":[2,1],"nested":{"a":null,"b":true},"z":1}');
	});

	test("semantic digest includes the observer path", () => {
		const payload = { block_height: 42, block_hash: "0xabc" };
		expect(semanticObserverSha256("/new_block", payload)).not.toBe(
			semanticObserverSha256("/new_burn_block", payload),
		);
	});

	test("raw digest hashes exact request bytes", () => {
		const body = bodyFromText('{"b":1,"a":2}');
		expect(parseObserverBody<Record<string, number>>(body)).toEqual({
			b: 1,
			a: 2,
		});
		expect(sha256Hex(body)).toBe(
			"a1d46c3cdb4e5795c8d637f80daeb578ebb1a9a65dc1ed5f11f51794c3c89f3a",
		);
	});
});
