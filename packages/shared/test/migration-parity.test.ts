import { afterEach, describe, expect, test } from "bun:test";
import { migrationNames, runFileMigrations } from "../src/db/migrate.ts";
import {
	type MigrationRole,
	setMigrationRole,
} from "../src/db/migration-role.ts";
import {
	createTestDatabase,
	createTestDb,
	dropTestDatabase,
	hasTestDb,
} from "../src/db/test-helpers.ts";
import {
	type SchemaSnapshot,
	captureSchema,
	diffSchemas,
	formatSchemaDiff,
	schemaDigest,
} from "./schema-digest.ts";

/**
 * The upgrade gate: a database built fresh from the whole migration set must be
 * schema-identical to one that was built at an earlier revision and then
 * upgraded the rest of the way.
 *
 * CI already proves the migrations apply to an empty database. That proves
 * nothing about an upgrade — the paths only coincide as long as every migration
 * is a pure function of the schema it inherits. They stop coinciding the moment
 * a migration branches on catalog state (`IF NOT EXISTS`, `to_regclass` probes,
 * DO blocks — 44 of the current migrations use one), the moment a squashed
 * baseline is introduced for fresh installs, or the moment a migration's effect
 * depends on data that only an upgraded database has. Every one of those
 * failures is silent without this test: the deploy succeeds and the schemas
 * quietly disagree.
 *
 * Needs a database it can `CREATE DATABASE` against (local dev: 127.0.0.1:5440).
 */
const HAS_DB = hasTestDb("migration parity");

// Each build applies the full migration set to a brand new database — several
// per test, so the bun default 5s budget is nowhere near enough.
const BUILD_TIMEOUT_MS = 300_000;

/**
 * Build a database and return its schema shape. With `through`, the database is
 * first taken to that migration (a "released" revision) and then upgraded to
 * latest in a second pass — the same two-step a deploy performs.
 */
async function buildSchema(
	role: MigrationRole,
	through?: string,
): Promise<SchemaSnapshot> {
	const url = await createTestDatabase();
	const db = createTestDb(url);
	try {
		// The role is a module-level singleton read by every migration's plane
		// helpers, so it must be set before either pass and both passes of a
		// comparison must use the same one: we are comparing a plane against
		// itself, not source against target.
		setMigrationRole(role);
		if (through !== undefined) {
			const partial = await runFileMigrations(db, { through });
			if (partial.error) throw partial.error;
			// Without this the whole suite could pass vacuously: if partial
			// application silently ran everything, the "upgraded" database would be
			// a fresh install and the comparison would prove nothing.
			expect(partial.results?.at(-1)?.migrationName).toBe(through);
		}
		const rest = await runFileMigrations(db);
		if (rest.error) throw rest.error;
		if (through !== undefined) expect(rest.results?.length).toBeGreaterThan(0);
		return await captureSchema(db);
	} finally {
		await db.destroy();
		await dropTestDatabase(url);
	}
}

function expectIdenticalSchemas(
	fresh: SchemaSnapshot,
	upgraded: SchemaSnapshot,
	context: string,
): void {
	const diff = diffSchemas(fresh, upgraded);
	if (diff.length > 0) {
		throw new Error(
			`${context}: ${diff.length} schema object(s) diverged between a fresh install and an upgrade\n${formatSchemaDiff(diff)}`,
		);
	}
	expect(schemaDigest(upgraded)).toBe(schemaDigest(fresh));
}

describe.skipIf(!HAS_DB)("migration upgrade parity", () => {
	// Leave the singleton where the rest of the suite expects it.
	afterEach(() => setMigrationRole("both"));

	test(
		"a database upgraded from an earlier revision matches a fresh install",
		async () => {
			const names = await migrationNames();
			expect(names.length).toBeGreaterThan(1);
			const midpoint = names[Math.floor(names.length / 2)];

			const fresh = await buildSchema("both");
			const upgraded = await buildSchema("both", midpoint);
			expectIdenticalSchemas(fresh, upgraded, `upgrade from ${midpoint}`);
		},
		BUILD_TIMEOUT_MS,
	);

	test(
		"parity holds no matter which revision the upgrade starts from",
		async () => {
			const names = await migrationNames();
			// Quarter points: enough spread to cover early table creation, the
			// mid-history renames, and the recent plane-gated migrations, without
			// paying for a rebuild per migration.
			const starts = [0.25, 0.5, 0.75].map(
				(f) => names[Math.floor(names.length * f)],
			);

			const fresh = await buildSchema("both");
			for (const start of starts) {
				const upgraded = await buildSchema("both", start);
				expectIdenticalSchemas(fresh, upgraded, `upgrade from ${start}`);
			}
		},
		BUILD_TIMEOUT_MS,
	);

	// Under the source/target split each database sees every migration but only
	// its own plane's DDL, so parity has to hold per plane: a control migration
	// that is a no-op on SOURCE must be a no-op on an upgraded SOURCE too.
	for (const role of ["source", "target"] as const) {
		test(
			`the ${role} plane's schema is upgrade-stable`,
			async () => {
				const names = await migrationNames();
				const midpoint = names[Math.floor(names.length / 2)];

				const fresh = await buildSchema(role);
				const upgraded = await buildSchema(role, midpoint);
				expectIdenticalSchemas(fresh, upgraded, `${role} plane`);
			},
			BUILD_TIMEOUT_MS,
		);
	}

	test(
		"the snapshot captures the objects an upgrade could break",
		async () => {
			// A parity assertion is only as good as what it looks at: if
			// captureSchema silently stopped reading indexes or constraints, every
			// parity test above would still pass. Pin the object classes.
			const fresh = await buildSchema("both");
			const kinds = new Set(Object.keys(fresh).map((key) => key.split(" ")[0]));
			for (const kind of [
				"table",
				"column",
				"index",
				"constraint",
				"routine",
				"trigger",
				"sequence",
				"extension",
			]) {
				expect(kinds).toContain(kind);
			}
			// Guards against a query that silently returns nothing (wrong schema
			// name, a filter that matches everything) leaving a near-empty snapshot
			// that trivially equals itself.
			expect(Object.keys(fresh).length).toBeGreaterThan(500);
		},
		BUILD_TIMEOUT_MS,
	);
});
