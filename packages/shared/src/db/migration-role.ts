/**
 * Per-migration DB-plane gating for the source/target split.
 *
 * Under the split, SOURCE (chain DB) holds only chain+decoded tables — the
 * control-plane tables were dropped to reclaim space — while TARGET (platform
 * DB) holds the control plane. `migrate.ts` still runs EVERY migration on EVERY
 * database (kysely integrity: the provider set must never be filtered per-DB, or
 * kysely throws "previously executed migration is missing" because each DB's
 * `kysely_migration` already records all of them). Instead, `migrate.ts` sets a
 * role before each pass and a migration gates its DDL with the helpers below: a
 * control migration's `up()` is a no-op on SOURCE but is still recorded applied,
 * so there is no missing-migration error and no re-run.
 *
 * `'both'` is single-DB / collapsed-split mode (dev / OSS / CI): every helper
 * runs, identical to pre-split behavior.
 *
 * Authoring a new migration under the split:
 *   export async function up(db: Kysely<unknown>): Promise<void> {
 *     await onControlPlane(() => sql`ALTER TABLE accounts ADD COLUMN …`.execute(db));
 *     await onChainPlane(() => sql`ALTER TABLE blocks ADD COLUMN …`.execute(db));
 *     // schema-wide / mixed statements: leave unwrapped (run on both).
 *   }
 */

export type MigrationRole = "source" | "target" | "both";

// Module-level singleton: migrate runs sequentially in one process, one target
// at a time, so there is no concurrency to guard.
let currentRole: MigrationRole = "both";

export function setMigrationRole(role: MigrationRole): void {
	currentRole = role;
}

export function getMigrationRole(): MigrationRole {
	return currentRole;
}

/** Run control-plane (TARGET) DDL only when this pass targets the control plane. */
export async function onControlPlane(fn: () => Promise<void>): Promise<void> {
	if (currentRole === "target" || currentRole === "both") await fn();
}

/** Run chain/decoded (SOURCE) DDL only when this pass targets the chain plane. */
export async function onChainPlane(fn: () => Promise<void>): Promise<void> {
	if (currentRole === "source" || currentRole === "both") await fn();
}
