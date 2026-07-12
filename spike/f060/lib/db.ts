// f060 SPIKE — shared DB plumbing for the D1 baseline + D2 worker PoC.
//
// Connects to the local dev Postgres (docker-postgres-1, 127.0.0.1:5440) using
// the REAL product connection code (`getTargetDb` from
// packages/shared/src/db/index.ts) so the benchmark exercises the same Kysely +
// postgres.js stack production uses — not a bespoke test double. Every table
// this spike creates lives under a dedicated, disposable schema
// (`subgraph_spike_f060*`) that is dropped before and after each run.
//
// No product file is imported for its side effects beyond normal library use;
// nothing here writes to `packages/`.
import { resolve } from "node:path";
import { sql } from "kysely";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

// Match `bun run migrate`'s default local connection unless the caller already
// set DATABASE_URL (e.g. in CI or a differently-configured dev box).
process.env.DATABASE_URL ??=
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const { getTargetDb } = await import(
	resolve(REPO_ROOT, "packages/shared/src/db/index.ts")
);

export function db() {
	return getTargetDb();
}

/** Drop + recreate a scratch schema so repeated runs never accumulate state. */
export async function resetSchema(schemaName: string): Promise<void> {
	const database = db();
	await sql
		.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
		.execute(database);
}

/** Drop a scratch schema on the way out. */
export async function dropSchema(schemaName: string): Promise<void> {
	const database = db();
	await sql
		.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
		.execute(database);
}

export async function assertReachable(): Promise<void> {
	const database = db();
	await sql.raw("SELECT 1").execute(database);
}
