import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	getMigrationRole,
	onChainPlane,
	onControlPlane,
	setMigrationRole,
} from "../src/db/migration-role.ts";
import { migrationTargets } from "../src/db/migrate.ts";

describe("migration-role gating", () => {
	afterEach(() => setMigrationRole("both"));

	test("onControlPlane runs only when role is target or both", async () => {
		const ran: string[] = [];
		for (const role of ["source", "target", "both"] as const) {
			setMigrationRole(role);
			await onControlPlane(async () => {
				ran.push(role);
			});
		}
		expect(ran).toEqual(["target", "both"]);
	});

	test("onChainPlane runs only when role is source or both", async () => {
		const ran: string[] = [];
		for (const role of ["source", "target", "both"] as const) {
			setMigrationRole(role);
			await onChainPlane(async () => {
				ran.push(role);
			});
		}
		expect(ran).toEqual(["source", "both"]);
	});

	test("non-matching branch resolves without invoking fn", async () => {
		setMigrationRole("source");
		let called = false;
		await expect(
			onControlPlane(async () => {
				called = true;
			}),
		).resolves.toBeUndefined();
		expect(called).toBe(false);
	});

	test("getMigrationRole reflects setMigrationRole; default is both", async () => {
		// default restored by afterEach
		expect(getMigrationRole()).toBe("both");
		setMigrationRole("target");
		expect(getMigrationRole()).toBe("target");
	});
});

describe("migrationTargets resolution", () => {
	const ENV_KEYS = [
		"DATABASE_URL",
		"SOURCE_DATABASE_URL",
		"TARGET_DATABASE_URL",
	] as const;
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const k of ENV_KEYS) saved[k] = process.env[k];
		for (const k of ENV_KEYS) {
			// biome-ignore lint/performance/noDelete: env vars must be truly removed
			delete process.env[k];
		}
	});
	afterEach(() => {
		for (const k of ENV_KEYS) {
			if (saved[k] === undefined) {
				// biome-ignore lint/performance/noDelete: env vars must be truly removed
				delete process.env[k];
			} else {
				process.env[k] = saved[k];
			}
		}
	});

	test("single-DB (DATABASE_URL only) → one 'both' target", () => {
		process.env.DATABASE_URL = "postgres://x@h:5432/a";
		expect(migrationTargets()).toEqual([
			{ url: "postgres://x@h:5432/a", role: "both" },
		]);
	});

	test("collapsed split (SOURCE===TARGET) → one 'both' target", () => {
		process.env.SOURCE_DATABASE_URL = "postgres://x@h:5432/a";
		process.env.TARGET_DATABASE_URL = "postgres://x@h:5432/a";
		expect(migrationTargets()).toEqual([
			{ url: "postgres://x@h:5432/a", role: "both" },
		]);
	});

	test("active split → source + target tagged roles", () => {
		process.env.SOURCE_DATABASE_URL = "postgres://x@postgres:5432/secondlayer";
		process.env.TARGET_DATABASE_URL =
			"postgres://x@postgres-platform:5432/secondlayer_platform";
		expect(migrationTargets()).toEqual([
			{ url: "postgres://x@postgres:5432/secondlayer", role: "source" },
			{
				url: "postgres://x@postgres-platform:5432/secondlayer_platform",
				role: "target",
			},
		]);
	});

	test("SOURCE_ + DATABASE_URL fallback for target → distinct roles", () => {
		process.env.DATABASE_URL = "postgres://x@postgres-platform:5432/plat";
		process.env.SOURCE_DATABASE_URL = "postgres://x@postgres:5432/chain";
		// source = SOURCE_; target = DATABASE_URL → distinct → split
		expect(migrationTargets()).toEqual([
			{ url: "postgres://x@postgres:5432/chain", role: "source" },
			{ url: "postgres://x@postgres-platform:5432/plat", role: "target" },
		]);
	});
});
