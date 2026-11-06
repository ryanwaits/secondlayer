import { describe, expect, test } from "bun:test";
import { BRIDGE_TOKENS, shortAddress, toBaseUnits } from "./bridge";

const [MEGA, PEPE] = BRIDGE_TOKENS;

describe("toBaseUnits", () => {
	test("scales whole tokens by the token's decimals", () => {
		expect(toBaseUnits("25", MEGA)).toEqual({
			ok: true,
			units: "2500",
			overCap: false,
		});
		expect(toBaseUnits("100", PEPE)).toEqual({
			ok: true,
			units: "100000",
			overCap: false,
		});
	});

	test("keeps fractions exact and accepts thousands separators", () => {
		expect(toBaseUnits("1,000.5", PEPE)).toMatchObject({ units: "1000500" });
		expect(toBaseUnits("0.01", MEGA)).toMatchObject({ units: "1" });
	});

	test("refuses more fraction digits than the token has", () => {
		expect(toBaseUnits("0.001", MEGA)).toEqual({
			ok: false,
			reason: "decimals",
		});
	});

	test("refuses empty, zero and non-numeric input", () => {
		expect(toBaseUnits("  ", MEGA)).toEqual({ ok: false, reason: "empty" });
		expect(toBaseUnits("0", MEGA)).toEqual({ ok: false, reason: "invalid" });
		expect(toBaseUnits("-5", MEGA)).toEqual({ ok: false, reason: "invalid" });
		expect(toBaseUnits("1e3", MEGA)).toEqual({ ok: false, reason: "invalid" });
	});

	test("flags amounts past the cap but still converts them", () => {
		expect(toBaseUnits("10000", MEGA)).toMatchObject({ overCap: false });
		expect(toBaseUnits("10000.01", MEGA)).toMatchObject({
			units: "1000001",
			overCap: true,
		});
	});
});

describe("shortAddress", () => {
	test("keeps both ends of a long address", () => {
		expect(shortAddress("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")).toBe(
			"SP2J6Z…9EJ7",
		);
	});

	test("leaves short strings alone", () => {
		expect(shortAddress("SP123")).toBe("SP123");
	});
});
