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

	test("PG gets 25% of RAM on launch (proc-heavy split, 2026-05-13)", () => {
		// 6144 * 0.25 = 1536. PG is the under-utilized container on Launch — most
		// CPU goes to the proc, which is CPU-bound during backfill.
		expect(PLANS.launch.containers.postgres.memoryMb).toBe(1536);
	});

	test("processor gets 55% of RAM on scale", () => {
		// 24576 * 0.55 = 13516
		expect(PLANS.scale.containers.processor.memoryMb).toBe(13516);
	});

	test("api gets 20% of RAM on scale", () => {
		// Unchanged from the prior allocation — api is light steady-state.
		expect(PLANS.scale.containers.api.memoryMb).toBe(4915);
	});

	test("processor gets at least 50% of plan CPU (backfill throughput)", () => {
		for (const plan of Object.values(PLANS)) {
			if (plan.id === "enterprise") continue;
			expect(plan.containers.processor.cpus).toBeGreaterThanOrEqual(
				plan.totalCpus * 0.5,
			);
		}
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
