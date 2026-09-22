import { describe, expect, test } from "bun:test";
import { ContinuityError, checkContinuity } from "./backfill.ts";

describe("checkContinuity", () => {
	test("does not throw on the first block ever applied (no previous hash)", () => {
		expect(() =>
			checkContinuity(840_000, { prevHash: "a".repeat(64) }, undefined),
		).not.toThrow();
	});

	test("does not throw when prevHash matches the last applied block's hash", () => {
		const lastHash = "b".repeat(64);
		expect(() =>
			checkContinuity(840_001, { prevHash: lastHash }, lastHash),
		).not.toThrow();
	});

	test("throws when a block's prevHash does not match the last applied block's hash", () => {
		const lastHash = "c".repeat(64);
		const wrongPrevHash = "d".repeat(64);
		expect(() =>
			checkContinuity(840_001, { prevHash: wrongPrevHash }, lastHash),
		).toThrow(ContinuityError);
	});
});
