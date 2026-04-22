import { describe, expect, test } from "bun:test";
import {
	getSchedulePolicyForPlan,
	minCronIntervalSeconds,
	validateWorkflowSchedule,
} from "../src/schedule-policy.ts";

describe("schedule policy", () => {
	test("hobby floors at 5 min", () => {
		expect(getSchedulePolicyForPlan("hobby").minIntervalSeconds).toBe(300);
	});
	test("unknown plan falls back to hobby", () => {
		expect(getSchedulePolicyForPlan("nope").minIntervalSeconds).toBe(300);
	});
	test("enterprise is 1s floor", () => {
		expect(getSchedulePolicyForPlan("enterprise").minIntervalSeconds).toBe(1);
	});
});

describe("minCronIntervalSeconds", () => {
	test("every-minute cron → 60s", () => {
		expect(minCronIntervalSeconds("* * * * *")).toBe(60);
	});
	test("every-5-minutes cron → 300s", () => {
		expect(minCronIntervalSeconds("*/5 * * * *")).toBe(300);
	});
	test("hourly → 3600s", () => {
		expect(minCronIntervalSeconds("0 * * * *")).toBe(3600);
	});
	test("specific minutes 0,30 → 30*60s", () => {
		expect(minCronIntervalSeconds("0,30 * * * *")).toBe(30 * 60);
	});
	test("nonsense parse returns null", () => {
		expect(minCronIntervalSeconds("not a cron")).toBeNull();
	});
});

describe("validateWorkflowSchedule", () => {
	test("every-minute on hobby rejects", () => {
		const r = validateWorkflowSchedule("hobby", "* * * * *");
		expect(r.ok).toBe(false);
		expect(r.reason).toContain("hobby");
	});
	test("every-5-min on hobby passes", () => {
		const r = validateWorkflowSchedule("hobby", "*/5 * * * *");
		expect(r.ok).toBe(true);
		expect(r.observedIntervalSeconds).toBe(300);
	});
	test("every-minute on launch passes", () => {
		const r = validateWorkflowSchedule("launch", "* * * * *");
		expect(r.ok).toBe(true);
	});
});
