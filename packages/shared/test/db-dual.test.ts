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

describe("getDbSplitStatus", () => {
	test("single-URL mode: not active, mode=single, no credentials leaked", async () => {
		unsetEnv("SOURCE_DATABASE_URL");
		unsetEnv("TARGET_DATABASE_URL");
		process.env.DATABASE_URL = "postgres://postgres:secret@localhost:5432/a";

		const { getDbSplitStatus } = await import("../src/db/index.ts");
		const status = getDbSplitStatus();
		expect(status.active).toBe(false);
		expect(status.mode).toBe("single");
		expect(status.sourceDb).toBe("localhost:5432/a");
		expect(status.sourceDb).toBe(status.targetDb);
		expect(status.sourceDb).not.toContain("secret");
	});

	test("dual-URL mode: active, mode=split, distinct DBs", async () => {
		process.env.SOURCE_DATABASE_URL =
			"postgres://postgres:x@postgres:5432/secondlayer";
		process.env.TARGET_DATABASE_URL =
			"postgres://postgres:x@postgres-platform:5432/secondlayer_platform";

		const { getDbSplitStatus } = await import("../src/db/index.ts");
		const status = getDbSplitStatus();
		expect(status.active).toBe(true);
		expect(status.mode).toBe("split");
		expect(status.sourceDb).toBe("postgres:5432/secondlayer");
		expect(status.targetDb).toBe("postgres-platform:5432/secondlayer_platform");
	});
});

describe("assertDbSplit", () => {
	test("dormant single-DB in prod warns, never throws", async () => {
		unsetEnv("SOURCE_DATABASE_URL");
		unsetEnv("TARGET_DATABASE_URL");
		process.env.DATABASE_URL = "postgres://postgres:x@localhost:5432/a";
		process.env.NODE_ENV = "production";

		const { assertDbSplit } = await import("../src/db/index.ts");
		expect(() => assertDbSplit()).not.toThrow();
	});

	test("split prod with one var unset + DATABASE_URL absent → DEFAULT_URL, no throw", async () => {
		unsetEnv("DATABASE_URL");
		unsetEnv("TARGET_DATABASE_URL");
		process.env.SOURCE_DATABASE_URL =
			"postgres://postgres:x@postgres:5432/secondlayer";
		process.env.NODE_ENV = "production";

		const { assertDbSplit, getDbSplitStatus } = await import(
			"../src/db/index.ts"
		);
		// Target falls through to the built-in DEFAULT_URL — the silent wrong-DB case.
		expect(getDbSplitStatus().targetDb).toBe("localhost:5432/secondlayer_dev");
		expect(() => assertDbSplit()).not.toThrow();
	});

	test("active split never throws", async () => {
		unsetEnv("DATABASE_URL");
		process.env.SOURCE_DATABASE_URL =
			"postgres://postgres:x@postgres:5432/secondlayer";
		process.env.TARGET_DATABASE_URL =
			"postgres://postgres:x@postgres-platform:5432/secondlayer_platform";

		const { assertDbSplit } = await import("../src/db/index.ts");
		expect(() => assertDbSplit()).not.toThrow();
	});
});
