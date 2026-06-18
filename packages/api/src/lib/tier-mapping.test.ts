import { describe, expect, test } from "bun:test";
import { isSelfServeTier, isUpgradeableTier } from "./tier-mapping.ts";

describe("tier-mapping self-serve vs upgradeable", () => {
	test("launch is both upgradeable and self-serve", () => {
		expect(isUpgradeableTier("launch")).toBe(true);
		expect(isSelfServeTier("launch")).toBe(true);
	});

	// Scale stays upgradeable (the webhook reverse-map needs it to resolve
	// manually-created Scale subs) but is NOT self-serve — it is contact-sales.
	test("scale is upgradeable but NOT self-serve", () => {
		expect(isUpgradeableTier("scale")).toBe(true);
		expect(isSelfServeTier("scale")).toBe(false);
	});

	test("enterprise / unknown are neither", () => {
		expect(isUpgradeableTier("enterprise")).toBe(false);
		expect(isSelfServeTier("enterprise")).toBe(false);
		expect(isUpgradeableTier("garbage")).toBe(false);
		expect(isSelfServeTier("garbage")).toBe(false);
	});
});
