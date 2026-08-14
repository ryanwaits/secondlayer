import { describe, expect, test } from "bun:test";
import { applyUpgrade, planUpgrade } from "./upgrade.ts";

describe("upgrade contract", () => {
	test("supported matrix + backup-first", () => {
		expect(
			planUpgrade({
				from: "v1.0.0",
				to: "v1.1.0",
				diskOk: true,
				schemaOk: true,
				backupDone: false,
			}).ok,
		).toBe(false);
		const plan = planUpgrade({
			from: "v1.0.0",
			to: "v1.1.0",
			diskOk: true,
			schemaOk: true,
			backupDone: true,
			supported: ["v1.0.0", "v1.1.0"],
		});
		expect(plan.ok).toBe(true);
		expect(plan.steps).toEqual([
			"pin",
			"preflight",
			"backup",
			"migrate",
			"health",
			"verify",
		]);
		expect(plan.rollback).toContain("forward-only");
		expect(applyUpgrade(plan).applied).toBe(false);
		expect(applyUpgrade(plan, { apply: true }).applied).toBe(true);
	});

	test("unsupported image is refused", () => {
		const plan = planUpgrade({
			from: "v1.0.0",
			to: "v9.9.9",
			diskOk: true,
			schemaOk: true,
			backupDone: true,
			supported: ["v1.0.0", "v1.1.0"],
		});
		expect(plan.ok).toBe(false);
	});
});
