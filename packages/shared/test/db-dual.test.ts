import { afterEach, beforeEach, describe, expect, test } from "bun:test";

/**
 * Unit tests for the dual-DB pool cache in `packages/shared/src/db/index.ts`.
 *
 * Validates the backward-compat contract: when only `DATABASE_URL` is set
 * (or all three URLs resolve to the same string), all getters return the
 * same Kysely instance — identical pre-sprint pool behavior preserved.
 *
 * Does not open DB connections. `postgres(...)` defers connection until the
 * first query, so creating a pool wrapper is a cheap in-memory operation.
 */

const ENV_KEYS = [
	"DATABASE_URL",
	"SOURCE_DATABASE_URL",
	"TARGET_DATABASE_URL",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(async () => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) {
			// biome-ignore lint/performance/noDelete: env vars must be truly removed
			delete process.env[k];
		} else {
			process.env[k] = saved[k];
		}
	}
	// Drop module cache so the next test re-imports with fresh env.
	// Bun's `import()` is cached by specifier; `delete` from the registry
	// via the Bun-specific loader isn't publicly exposed, so we instead
	// close + reimport. `closeDb()` empties the internal pool map.
	const mod = await import("../src/db/index.ts");
	await mod.closeDb();
});

function unsetEnv(key: string): void {
	// biome-ignore lint/performance/noDelete: env vars must be truly removed (setting to undefined coerces to "undefined" string)
	delete process.env[key];
}

describe("dual-DB getters", () => {
	test("single-URL mode: getSourceDb() === getTargetDb() === getDb()", async () => {
		unsetEnv("SOURCE_DATABASE_URL");
		unsetEnv("TARGET_DATABASE_URL");
		process.env.DATABASE_URL = "postgres://postgres:x@localhost:5432/a";

		const { getSourceDb, getTargetDb, getDb } = await import(
			"../src/db/index.ts"
		);
		expect(getSourceDb()).toBe(getTargetDb());
		expect(getTargetDb()).toBe(getDb());
	});

	test("explicit same-URL mode: both env vars point at DATABASE_URL → shared pool", async () => {
		const url = "postgres://postgres:x@localhost:5432/same";
		process.env.DATABASE_URL = url;
		process.env.SOURCE_DATABASE_URL = url;
		process.env.TARGET_DATABASE_URL = url;

		const { getSourceDb, getTargetDb } = await import("../src/db/index.ts");
		expect(getSourceDb()).toBe(getTargetDb());
	});

	test("dual-URL mode: distinct URLs → distinct Kysely instances", async () => {
		process.env.DATABASE_URL = "postgres://postgres:x@localhost:5432/fallback";
		process.env.SOURCE_DATABASE_URL =
			"postgres://postgres:x@localhost:5432/db_source";
		process.env.TARGET_DATABASE_URL =
			"postgres://postgres:x@localhost:5432/db_target";

		const { getSourceDb, getTargetDb } = await import("../src/db/index.ts");
		expect(getSourceDb()).not.toBe(getTargetDb());
	});

	test("getRawClient(role): source vs. target pool separation", async () => {
		process.env.SOURCE_DATABASE_URL =
			"postgres://postgres:x@localhost:5432/db_source";
		process.env.TARGET_DATABASE_URL =
			"postgres://postgres:x@localhost:5432/db_target";

		const { getRawClient } = await import("../src/db/index.ts");
		expect(getRawClient("source")).not.toBe(getRawClient("target"));
	});

	test("getRawClient() defaults to target role", async () => {
		process.env.SOURCE_DATABASE_URL =
			"postgres://postgres:x@localhost:5432/db_source";
		process.env.TARGET_DATABASE_URL =
			"postgres://postgres:x@localhost:5432/db_target";

		const { getRawClient } = await import("../src/db/index.ts");
		expect(getRawClient()).toBe(getRawClient("target"));
	});

	test("getDb(connectionString) bypasses env resolution", async () => {
		process.env.DATABASE_URL = "postgres://postgres:x@localhost:5432/default";

		const { getDb, getTargetDb } = await import("../src/db/index.ts");
		const override = getDb("postgres://postgres:x@localhost:5432/override");
		expect(override).not.toBe(getTargetDb());
	});
});
