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
	/** Loopback port the tenant's `api` service is published on
	 *  (`127.0.0.1:<api_port>`, `docker/workload/tenant.compose.yml`). The
	 *  gateway is a HOST process, not a container on the tenant's compose
	 *  network — it has no service-name DNS, so this loopback port is the
	 *  only way it reaches a tenant's `api` (review fix: `tenant-<acct8>-api`
	 *  never resolved from the host). Allocated once, at insert, from
	 *  `tenant_api_port_seq` — never reused, so a stale reference from a
	 *  destroyed tenant can never collide with a newer one. */
	api_port: number;
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
	// Silence Postgres NOTICEs (e.g. the `ADD COLUMN IF NOT EXISTS ... already
	// exists, skipping` from ensureControlSchema's idempotent upgrade path) —
	// expected on every boot after the first, not worth logging as an object
	// on every restart.
	sql = postgres(url, { onnotice: () => {} });
	return sql;
}

/** Test-only: drop the cached singleton so a new `CONTROL_DATABASE_URL` (or
 *  a fresh test database) takes effect on the next `getControlDb()` call. */
export function resetControlDb(): void {
	sql = undefined;
}

/** First allocated port. Below this is left free for anything else already
 *  running on the host (the control DB itself, an ops SSH tunnel, ...). */
const API_PORT_SEQUENCE_START = 20000;

export async function ensureControlSchema(db: postgres.Sql): Promise<void> {
	// A dedicated sequence (not MAX(api_port)+1) makes allocation race-free
	// under concurrent inserts without a table lock — two accounts
	// provisioning at once always get two different ports. `START` takes a
	// literal, not a bind parameter, so this is `db.unsafe` with a
	// compile-time constant (never user input) spliced in, not a query
	// built from anything a caller passed in.
	await db.unsafe(
		`CREATE SEQUENCE IF NOT EXISTS tenant_api_port_seq START ${API_PORT_SEQUENCE_START}`,
	);
	await db`
		CREATE TABLE IF NOT EXISTS tenants (
			account_id TEXT PRIMARY KEY,
			acct8 TEXT NOT NULL UNIQUE,
			state TEXT NOT NULL DEFAULT 'provisioning',
			api_port INTEGER NOT NULL UNIQUE DEFAULT nextval('tenant_api_port_seq'),
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			stopped_at TIMESTAMPTZ,
			storage_cap_bytes BIGINT
		)
	`;
	// Upgrade path for a `tenants` table created before `api_port` existed
	// (no migration framework — this is the idempotent equivalent).
	await db`
		ALTER TABLE tenants
		ADD COLUMN IF NOT EXISTS api_port INTEGER UNIQUE
		DEFAULT nextval('tenant_api_port_seq')
	`;
	await db`ALTER TABLE tenants ALTER COLUMN api_port SET NOT NULL`;
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
 *  yet, allocating its `api_port` from the sequence in the same statement
 *  (race-free — see `ensureControlSchema`). Idempotent — a concurrent
 *  second request for the same account hits the PK conflict, does nothing,
 *  and gets back the WINNING row's port (never allocates a second one), so
 *  only one caller ever calls `up(account)` for real (`provisioner.ts`). */
export async function insertProvisioningTenant(
	db: postgres.Sql,
	accountId: string,
	acct8: string,
): Promise<{ inserted: boolean; apiPort: number }> {
	const inserted = await db<{ account_id: string; api_port: number }[]>`
		INSERT INTO tenants (account_id, acct8, state)
		VALUES (${accountId}, ${acct8}, 'provisioning')
		ON CONFLICT (account_id) DO NOTHING
		RETURNING account_id, api_port
	`;
	if (inserted.length > 0) {
		// biome-ignore lint/style/noNonNullAssertion: length > 0 guarantees index 0
		return { inserted: true, apiPort: inserted[0]!.api_port };
	}
	const existing = await getTenant(db, accountId);
	if (!existing) {
		// Lost the insert race to a `destroy()` that ran between the conflict
		// and this read — vanishingly unlikely, but never silently return a
		// bogus port for a row that no longer exists.
		throw new Error(`tenant row for ${accountId} vanished mid-insert`);
	}
	return { inserted: false, apiPort: existing.api_port };
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

/** `running` or `stopped` tenants — the two states the 5-minute credits poll
 *  (`provisioner.ts`'s `pollCredits`) acts on. `provisioning`/`destroyed`
 *  rows are excluded: a provisioning tenant isn't up yet to stop, and a
 *  destroyed one no longer has a row. */
export async function listPollableTenants(
	db: postgres.Sql,
): Promise<TenantRow[]> {
	return db<TenantRow[]>`
		SELECT * FROM tenants WHERE state IN ('running', 'stopped')
		ORDER BY created_at ASC
	`;
}

/** `running` tenants only — what the memory/storage samplers (`meters.ts`)
 *  iterate. A `stopped` tenant's containers aren't running, so sampling them
 *  would either error or report a stale/zero number; skip them entirely
 *  rather than meter a stack that isn't billing memory anyway. */
export async function listRunningTenants(
	db: postgres.Sql,
): Promise<TenantRow[]> {
	return db<TenantRow[]>`
		SELECT * FROM tenants WHERE state = 'running'
		ORDER BY created_at ASC
	`;
}
