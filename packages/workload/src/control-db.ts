/**
 * The workload host's own small control Postgres — NOT a tenant database.
 * One table, `tenants`, tracking which account maps to which compose
 * project and what state it's in. No migration framework (044 executor
 * notes): one idempotent `CREATE TABLE IF NOT EXISTS`, run at boot.
 *
 * Secrets (`INSTANCE_TOKEN`, `POSTGRES_PASSWORD`, ...) are NOT stored here —
 * they live in files on disk, root-only, one directory per tenant (Design).
 * This table only ever holds routing/state, so a leak of it leaks no
 * tenant's credentials.
 */

import postgres from "postgres";

export type TenantState = "provisioning" | "running" | "stopped" | "destroyed";

export interface TenantRow {
	account_id: string;
	acct8: string;
	state: TenantState;
	created_at: Date;
	stopped_at: Date | null;
	storage_cap_bytes: string | null;
}

/** First 8 hex chars of the account id with non-hex characters stripped —
 *  short, stable, and safe in a compose project name / socket path
 *  (`tenant-<acct8>`). Collisions are astronomically unlikely at this scale
 *  and the control DB's `acct8` UNIQUE constraint catches one if it ever
 *  happens, rather than silently colliding two tenants. */
export function acct8For(accountId: string): string {
	return accountId
		.replace(/[^a-zA-Z0-9]/g, "")
		.slice(0, 8)
		.toLowerCase();
}

let sql: postgres.Sql | undefined;

/** Lazy singleton, mirroring `@secondlayer/shared/db`'s pool-per-URL
 *  pattern but far simpler: the workload host only ever talks to ONE
 *  control database, never a tenant's. */
export function getControlDb(
	url: string | undefined = process.env.CONTROL_DATABASE_URL,
): postgres.Sql {
	if (sql) return sql;
	if (!url) {
		throw new Error(
			"CONTROL_DATABASE_URL is required — the workload host's own control Postgres, never a tenant's.",
		);
	}
	sql = postgres(url);
	return sql;
}

/** Test-only: drop the cached singleton so a new `CONTROL_DATABASE_URL` (or
 *  a fresh test database) takes effect on the next `getControlDb()` call. */
export function resetControlDb(): void {
	sql = undefined;
}

export async function ensureControlSchema(db: postgres.Sql): Promise<void> {
	await db`
		CREATE TABLE IF NOT EXISTS tenants (
			account_id TEXT PRIMARY KEY,
			acct8 TEXT NOT NULL UNIQUE,
			state TEXT NOT NULL DEFAULT 'provisioning',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			stopped_at TIMESTAMPTZ,
			storage_cap_bytes BIGINT
		)
	`;
}

export async function getTenant(
	db: postgres.Sql,
	accountId: string,
): Promise<TenantRow | undefined> {
	const rows = await db<
		TenantRow[]
	>`SELECT * FROM tenants WHERE account_id = ${accountId}`;
	return rows[0];
}

/** First-request bootstrap: insert `provisioning` if this account has no row
 *  yet. Idempotent — a concurrent second request for the same account hits
 *  the PK conflict and does nothing, so only one caller ever calls
 *  `up(account)` for real (`provisioner.ts`). */
export async function insertProvisioningTenant(
	db: postgres.Sql,
	accountId: string,
	acct8: string,
): Promise<{ inserted: boolean }> {
	const rows = await db<{ account_id: string }[]>`
		INSERT INTO tenants (account_id, acct8, state)
		VALUES (${accountId}, ${acct8}, 'provisioning')
		ON CONFLICT (account_id) DO NOTHING
		RETURNING account_id
	`;
	return { inserted: rows.length > 0 };
}

export async function setTenantState(
	db: postgres.Sql,
	accountId: string,
	state: TenantState,
): Promise<void> {
	if (state === "stopped") {
		await db`UPDATE tenants SET state = ${state}, stopped_at = now() WHERE account_id = ${accountId}`;
		return;
	}
	await db`UPDATE tenants SET state = ${state}, stopped_at = NULL WHERE account_id = ${accountId}`;
}

export async function deleteTenant(
	db: postgres.Sql,
	accountId: string,
): Promise<void> {
	await db`DELETE FROM tenants WHERE account_id = ${accountId}`;
}

export async function listTenants(db: postgres.Sql): Promise<TenantRow[]> {
	return db<TenantRow[]>`SELECT * FROM tenants ORDER BY created_at ASC`;
}
