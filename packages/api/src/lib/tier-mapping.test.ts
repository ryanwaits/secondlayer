import { describe, expect, test } from "bun:test";
import { isSelfServeTier, isUpgradeableTier } from "./tier-mapping.ts";

describe("tier-mapping self-serve vs upgradeable", () => {
	test("launch is both upgradeable and self-serve", () => {
		expect(isUpgradeableTier("launch")).toBe(true);
		expect(isSelfServeTier("launch")).toBe(true);
	});

	test("scale is upgradeable and self-serve", () => {
		expect(isUpgradeableTier("scale")).toBe(true);
		expect(isSelfServeTier("scale")).toBe(true);
	});

	test("enterprise / unknown are neither", () => {
		expect(isUpgradeableTier("enterprise")).toBe(false);
		expect(isSelfServeTier("enterprise")).toBe(false);
		expect(isUpgradeableTier("garbage")).toBe(false);
		expect(isSelfServeTier("garbage")).toBe(false);
	});
});
