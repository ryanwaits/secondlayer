import { describe, expect, test } from "bun:test";
import { planBackup, restoreBackup } from "./backup.ts";

describe("backup bundle", () => {
	test("refuses plaintext keys", () => {
		const plan = planBackup({
			network: "mainnet",
			encryptedKeys: false,
			fromHeight: 0,
		});
		expect(plan.ok).toBe(false);
		expect(restoreBackup(plan, { apply: true }).ok).toBe(false);
	});

	test("wiped-host restore is deep-green after apply", () => {
		const plan = planBackup({
			network: "mainnet",
			encryptedKeys: true,
			fromHeight: 0,
			toHeight: 100,
		});
		expect(plan.ok).toBe(true);
		expect(plan.manifest.parts).toEqual([
			"db",
			"config",
			"keys",
			"handlers",
			"scope",
		]);
		const dry = restoreBackup(plan);
		expect(dry.ok && !dry.applied).toBe(true);
		const applied = restoreBackup(plan, { apply: true, deepVerify: true });
		expect(applied.ok && applied.applied && applied.deep_green).toBe(true);
	});
});
