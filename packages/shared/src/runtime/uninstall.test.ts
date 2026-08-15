import { describe, expect, test } from "bun:test";
import { planUninstall, uninstallCommand } from "./uninstall.ts";

const base = {
	purge: false,
	confirmed: false,
	keysBackedUp: false,
	secretsPresent: true,
	dataDir: "/data",
};

describe("uninstall planning", () => {
	test("the default keeps every byte of data", () => {
		const decision = planUninstall(base);
		expect(decision.ok).toBe(true);
		if (decision.ok) {
			expect(decision.plan.destroys).toEqual([]);
			expect(decision.plan.preserves.map((p) => p.what)).toContain("index");
			expect(decision.plan.preserves.map((p) => p.what)).toContain("secrets");
		}
	});

	test("purge without confirmation is refused", () => {
		const decision = planUninstall({ ...base, purge: true });
		expect(decision.ok).toBe(false);
	});

	test("purge is refused while the keys exist only here", () => {
		// The asymmetry this enforces: an index is rebuildable, keys are not. A
		// purge that takes unbacked keys with it is data loss, not an uninstall.
		const decision = planUninstall({
			...base,
			purge: true,
			confirmed: true,
			keysBackedUp: false,
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) expect(decision.reason).toContain("cannot");
	});

	test("purge proceeds once the keys are backed up", () => {
		const decision = planUninstall({
			...base,
			purge: true,
			confirmed: true,
			keysBackedUp: true,
		});
		expect(decision.ok).toBe(true);
		if (decision.ok) {
			expect(decision.plan.destroys).toContain("postgres_data");
			expect(decision.warnings.length).toBeGreaterThan(0);
		}
	});

	test("an instance holding no secrets can purge without a backup", () => {
		// Nothing irreplaceable to lose, so the gate would be theatre.
		const decision = planUninstall({
			...base,
			purge: true,
			confirmed: true,
			secretsPresent: false,
			keysBackedUp: false,
		});
		expect(decision.ok).toBe(true);
	});

	test("even a purge leaves the operator's key material on disk", () => {
		// Destroying the stack's volumes is what was asked for; shredding the
		// operator's own keys is not.
		const decision = planUninstall({
			...base,
			purge: true,
			confirmed: true,
			keysBackedUp: true,
		});
		expect(decision.ok).toBe(true);
		if (decision.ok) {
			expect(decision.plan.preserves.map((p) => p.what)).toContain("secrets");
		}
	});
});

describe("uninstall command", () => {
	test("the preserving path never passes -v", () => {
		// `-v` is the difference between an uninstall and a wipe.
		const decision = planUninstall(base);
		expect(decision.ok).toBe(true);
		if (decision.ok) {
			expect(uninstallCommand(decision.plan, "c.yml")).not.toContain("-v");
		}
	});

	test("the purge path passes -v", () => {
		const decision = planUninstall({
			...base,
			purge: true,
			confirmed: true,
			keysBackedUp: true,
		});
		expect(decision.ok).toBe(true);
		if (decision.ok) {
			expect(uninstallCommand(decision.plan, "c.yml")).toContain("-v");
		}
	});
});
