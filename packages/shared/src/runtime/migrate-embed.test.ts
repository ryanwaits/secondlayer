import { describe, expect, test } from "bun:test";
import {
	createMemoryMigrationRunner,
	migrateEmbedded,
} from "./migrate-embed.ts";

describe("embedded migration", () => {
	test("a successful pass applies once and releases the lock", async () => {
		const runner = createMemoryMigrationRunner();
		const result = await migrateEmbedded(runner);
		expect(result.ok).toBe(true);
		expect(result.applied).toEqual(["0116_coverage_schema"]);
		expect(runner.holders).toBe(0);
	});

	test("concurrent startup: the second process cannot steal the lock", async () => {
		const runner = createMemoryMigrationRunner({
			delayMs: 30,
		});
		const first = migrateEmbedded(runner);
		const second = migrateEmbedded(runner);
		const [a, b] = await Promise.all([first, second]);
		const ok = [a, b].filter((r) => r.ok);
		const blocked = [a, b].filter((r) => !r.ok);
		expect(ok).toHaveLength(1);
		expect(blocked[0]?.error).toContain("lock");
		expect(runner.appliedCount).toBe(1);
	});

	test("a failed migration releases the lock and does not look applied", async () => {
		const runner = createMemoryMigrationRunner({ fail: true });
		const result = await migrateEmbedded(runner);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("migration failed");
		expect(runner.holders).toBe(0);
	});
});
