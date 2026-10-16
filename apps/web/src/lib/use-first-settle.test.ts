import { describe, expect, test } from "bun:test";
import { FIRST_SETTLE_MS } from "./use-first-settle";

describe("first settle timeout", () => {
	test("waits long enough for a normal load but never hides data for long", () => {
		expect(FIRST_SETTLE_MS).toBeGreaterThanOrEqual(800);
		expect(FIRST_SETTLE_MS).toBeLessThanOrEqual(2000);
	});
});
