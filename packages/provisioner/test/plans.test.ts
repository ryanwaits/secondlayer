import { describe, expect, test } from "bun:test";
import { PLANS, getPlan, isValidPlanId } from "../src/plans.ts";

describe("plans", () => {
	test("every plan allocates 100% of total resources", () => {
		for (const plan of Object.values(PLANS)) {
			const totalMb =
				plan.containers.postgres.memoryMb +
				plan.containers.processor.memoryMb +
				plan.containers.api.memoryMb;
			// Allow ±2MB for rounding in Math.floor.
			expect(totalMb).toBeGreaterThanOrEqual(plan.totalMemoryMb - 3);
			expect(totalMb).toBeLessThanOrEqual(plan.totalMemoryMb);
		}
	});

	test("PG gets 50% of RAM on launch", () => {
		expect(PLANS.launch.containers.postgres.memoryMb).toBe(3072);
	});

	test("processor gets 30% of RAM on scale", () => {
		expect(PLANS.scale.containers.processor.memoryMb).toBe(7372);
	});

	test("api gets 20% of RAM on scale", () => {
		expect(PLANS.scale.containers.api.memoryMb).toBe(4915);
	});

	test("enterprise has unlimited storage (-1 sentinel)", () => {
		expect(PLANS.enterprise.storageLimitMb).toBe(-1);
	});

	test("enterprise has null price (custom)", () => {
		expect(PLANS.enterprise.monthlyPriceCents).toBeNull();
	});

	test("getPlan throws on unknown id", () => {
		expect(() => getPlan("bogus")).toThrow(/unknown plan/i);
	});

	test("isValidPlanId narrows correctly", () => {
		expect(isValidPlanId("hobby")).toBe(false);
		expect(isValidPlanId("launch")).toBe(true);
		expect(isValidPlanId("scale")).toBe(true);
		expect(isValidPlanId("enterprise")).toBe(true);
		expect(isValidPlanId("grow")).toBe(false);
		expect(isValidPlanId("pro")).toBe(false);
		expect(isValidPlanId("")).toBe(false);
	});
});
