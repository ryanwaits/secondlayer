import { describe, expect, test } from "bun:test";
import { PLANS, type PlanId } from "./pricing.ts";

describe("PLANS invariants", () => {
	test("every non-enterprise plan has positive monthlyPriceCents and non-null lookup keys", () => {
		const nonEnt: PlanId[] = ["launch", "scale"];
		for (const id of nonEnt) {
			const plan = PLANS[id];
			expect(typeof plan.monthlyPriceCents).toBe("number");
			expect(plan.monthlyPriceCents).toBeGreaterThan(0);
			expect(Number.isInteger(plan.monthlyPriceCents)).toBe(true);
			expect(plan.stripeLookupKey).not.toBeNull();
			expect(plan.stripeAnnualLookupKey).not.toBeNull();
		}
	});

	test("enterprise has null prices and null lookup keys", () => {
		const ent = PLANS.enterprise;
		expect(ent.monthlyPriceCents).toBeNull();
		expect(ent.stripeLookupKey).toBeNull();
		expect(ent.stripeAnnualLookupKey).toBeNull();
	});

	test("launch displayName is Pro, prices match published values", () => {
		expect(PLANS.launch.displayName).toBe("Pro");
		expect(PLANS.launch.monthlyPriceCents).toBe(7_900);
		expect(PLANS.scale.monthlyPriceCents).toBe(29_900);
	});

	test("all non-null stripeLookupKey values are unique", () => {
		const keys = Object.values(PLANS)
			.map((p) => p.stripeLookupKey)
			.filter((k): k is string => k !== null);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
