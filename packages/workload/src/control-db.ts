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

import { logger } from "@secondlayer/shared";
import { defineMachine } from "@secondlayer/shared/db/transition";
import postgres from "postgres";

export const TENANT_STATES = [
	"provisioning",
	"running",
	"stopped",
	"destroyed",
] as const;
export type TenantState = (typeof TENANT_STATES)[number];

export const STOP_REASONS = ["credits", "cap", "idle"] as const;
export type StopReason = (typeof STOP_REASONS)[number];

/** `(none) -> provisioning -> running <-> stopped`, and any live state ->
 *  `destroyed`. `destroyed` is a tombstone: the row stays, so a deleted
 *  account can never be provisioned again. A failed provision keeps its
 *  `provisioning` row (and the port and subnet it holds): the next request
 *  retries `up()` on that same row. */
export const TENANT_TRANSITIONS = defineMachine({
	states: TENANT_STATES,
	transitions: {
		provisioning: ["running", "destroyed"],
		running: ["stopped", "destroyed"],
		stopped: ["running", "destroyed"],
	},
});

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
	/** Index of this tenant's private /24 (`provisioner.ts`'s
	 *  `tenantNetwork`). Allocated once, at insert, from
	 *  `tenant_subnet_seq`, and never reused, so two tenants (live or since
	 *  destroyed) can't be handed the same subnet. */
	subnet_idx: number;
	created_at: Date;
	stopped_at: Date | null;
	storage_cap_bytes: string | null;
	/** The full 40-char sha of the `secondlayer-api` image this tenant's `api`/
	 *  `webhook-service` last came up on (`upgrade.ts`'s `resolveTargetSha`
	 *  reports the deployed target; `up()`/`start()`/`upgradeTenants` write
	 *  the sha they actually started). `null` until the first `up()`/`start()`
	 *  after this column existed. */
	image_sha: string | null;
	/** The deploy sequence (`/health`'s `deploy_sequence`) of that image's
	 *  deploy, as a string (BIGINT). A tenant is never rolled onto a target
	 *  with a lower one: its database may already hold a newer deploy's
	 *  migrations. `null` until a deploy that reports one. */
	image_sequence: string | null;
	/** Fingerprint of the compose template (file + local mounts) this tenant
	 *  last came up on (`provisioner.ts`'s `templateSha`). A tenant whose value
	 *  differs from the current template is rolled even on a current image. */
	template_sha: string | null;
	/** Why a `stopped` tenant stopped: `credits` (balance hit 0), `cap`
	 *  (monthly spend cap reached), or `idle` (no active webhooks and no
	 *  subgraphs). The poll restarts `credits`/`cap` once the account is ok
	 *  again; `idle` waits for a write or a `?wake` read. `null`
	 *  while running, and on rows stopped before this column existed (those
	 *  were all credit stops). */
	stop_reason: StopReason | null;
	/** When the tenant last came up (`up()`/`start()`). The idle stop never
	 *  fires within `IDLE_GRACE_MS` of it. `null` on rows from before this
	 *  column existed. */
	started_at: Date | null;
	/** Does this tenant run subgraphs. Derived, never set by a user: only the
	 *  reconcile in `processor-watch.ts` writes it, from the tenant's own
	 *  subgraph count. Picks the compose profile (`subgraph-processor` runs
	 *  only when true) and the memory floor (`stackMemoryFloorGb`). */
	has_subgraphs: boolean;
	/** UTC calendar day of the last storage sample that reached the platform
	 *  (`storage.gb_day` is one row per day). `null` until the first one. */
	last_storage_sample_day: Date | null;
	/** When the last nightly dump of this tenant's database finished. `null`
	 *  until the first one. */
	last_backup_at: Date | null;
}

/** First 8 hex chars of the account id with non-hex characters stripped —
 *  short, stable, and safe in a compose project name / socket path
 *  (`tenant-<acct8>`). Collisions are astronomically unlikely at this scale
 *  and the control DB's `acct8` UNIQUE constraint catches one if it ever
 *  happens (`insertProvisioningTenant` throws), rather than silently
 *  colliding two tenants. */
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
/** Last allocated port: the top of the range below the OS's ephemeral ports
 *  (32768+), which a loopback listener could collide with. */
export const API_PORT_MAX = 32767;
/** Last network index. `provisioner.ts`'s `tenantNetwork` addresses
 *  `TENANT_NETWORK_CAPACITY` (16384) /24s and index 0 is never allocated. */
export const SUBNET_IDX_MAX = 16383;

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
	// Same pattern for the per-tenant network index: never reused.
	await db`CREATE SEQUENCE IF NOT EXISTS tenant_subnet_seq START 1`;
	await ensureSequenceBounds(db);
	await db`
		CREATE TABLE IF NOT EXISTS tenants (
			account_id TEXT PRIMARY KEY,
			acct8 TEXT NOT NULL UNIQUE,
			state TEXT NOT NULL DEFAULT 'provisioning',
			api_port INTEGER NOT NULL UNIQUE DEFAULT nextval('tenant_api_port_seq'),
			subnet_idx INTEGER NOT NULL UNIQUE DEFAULT nextval('tenant_subnet_seq'),
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
	// Upgrade path for a `tenants` table created before auto-upgrade tracked
	// what each tenant runs (plan 064) — same idempotent-column pattern as
	// `api_port` above.
	await db`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS image_sha TEXT`;
	await db`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS image_sequence BIGINT`;
	await db`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS template_sha TEXT`;
	await db`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stop_reason TEXT`;
	await db`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`;
	// Rows from before this column all run a processor, so they start `true`
	// (the $10 floor) and the reconcile removes the processor before flipping
	// them: a stack never bills the $5 floor while a processor runs. New rows
	// start `false`.
	await db`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS has_subgraphs BOOLEAN NOT NULL DEFAULT true`;
	await db`ALTER TABLE tenants ALTER COLUMN has_subgraphs SET DEFAULT false`;
	// Tenants created before subgraph hosting have no network index: adding the
	// column with a sequence default gives every existing row its own.
	await db`
		ALTER TABLE tenants
		ADD COLUMN IF NOT EXISTS subnet_idx INTEGER UNIQUE
		DEFAULT nextval('tenant_subnet_seq')
	`;
	await db`ALTER TABLE tenants ALTER COLUMN subnet_idx SET NOT NULL`;
	// Daily jobs (storage sample, backup) read these on every short tick, so a
	// restart never skips a day and never repeats one.
	await db`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_storage_sample_day DATE`;
	await db`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_backup_at TIMESTAMPTZ`;
	await ensureStateChecks(db);
	await ensureRangeChecks(db);
}

/** Caps both pools so exhaustion fails the allocation loudly (a sequence at
 *  its MAXVALUE raises) instead of handing out a subnet or port the host
 *  cannot use. Idempotent. A sequence already past its cap is left alone and
 *  logged: that is a pool that is already over-allocated, and altering it
 *  would fail boot. */
async function ensureSequenceBounds(db: postgres.Sql): Promise<void> {
	const bounds: [name: string, max: number][] = [
		["tenant_api_port_seq", API_PORT_MAX],
		["tenant_subnet_seq", SUBNET_IDX_MAX],
	];
	for (const [name, max] of bounds) {
		const [seq] = await db<{ last_value: string | null }[]>`
			SELECT last_value FROM pg_sequences WHERE sequencename = ${name}
		`;
		if (seq?.last_value != null && Number(seq.last_value) > max) {
			logger.error("workload.control_db.sequence_over_cap", {
				sequence: name,
				lastValue: Number(seq.last_value),
				max,
			});
			continue;
		}
		// Names and bounds are compile-time constants above, never input.
		await db.unsafe(`ALTER SEQUENCE ${name} MAXVALUE ${max} NO CYCLE`);
	}
}

/** Range CHECKs on the two allocated columns. A table that already holds a
 *  row outside the range (which the allocators above never produced) gets the
 *  constraint `NOT VALID`: enforced for new rows, the old row logged for a
 *  human, boot not failed. Added once, guarded by name. */
async function ensureRangeChecks(db: postgres.Sql): Promise<void> {
	const checks: [name: string, expr: string][] = [
		[
			"tenants_subnet_idx_range_check",
			`subnet_idx BETWEEN 1 AND ${SUBNET_IDX_MAX}`,
		],
		[
			"tenants_api_port_range_check",
			`api_port BETWEEN ${API_PORT_SEQUENCE_START} AND ${API_PORT_MAX}`,
		],
	];
	for (const [name, expr] of checks) {
		const [existing] = await db`
			SELECT 1 FROM pg_constraint WHERE conname = ${name} AND conrelid = 'tenants'::regclass
		`;
		if (existing) continue;
		// Names and expressions are compile-time constants above, never input.
		const [violations] = await db.unsafe<{ n: string }[]>(
			`SELECT count(*) AS n FROM tenants WHERE NOT (${expr})`,
		);
		const bad = Number(violations?.n ?? 0);
		if (bad > 0) {
			logger.error("workload.control_db.range_check_violations", {
				constraint: name,
				rows: bad,
			});
		}
		await db.unsafe(
			`ALTER TABLE tenants ADD CONSTRAINT ${name} CHECK (${expr})${bad > 0 ? " NOT VALID" : ""}`,
		);
	}
}

/** Mirrors `TENANT_STATES` / `STOP_REASONS` and ties the two columns together:
 *  a tenant has a stop reason exactly when it is `stopped`. Rows from before
 *  `stop_reason` existed were all credit stops; the two UPDATEs below repair
 *  any row that would violate the constraint (no-ops once clean), so adding
 *  it can't fail boot. Constraints are added once, guarded by name. */
async function ensureStateChecks(db: postgres.Sql): Promise<void> {
	await db`UPDATE tenants SET stop_reason = 'credits' WHERE state = 'stopped' AND stop_reason IS NULL`;
	await db`UPDATE tenants SET stop_reason = NULL WHERE state <> 'stopped' AND stop_reason IS NOT NULL`;
	const checks: [name: string, expr: string][] = [
		["tenants_state_check", `state IN (${quoteList(TENANT_STATES)})`],
		[
			"tenants_stop_reason_check",
			`stop_reason IS NULL OR stop_reason IN (${quoteList(STOP_REASONS)})`,
		],
		[
			"tenants_stopped_has_reason_check",
			"(state = 'stopped') = (stop_reason IS NOT NULL)",
		],
	];
	for (const [name, expr] of checks) {
		const [existing] = await db`
			SELECT 1 FROM pg_constraint WHERE conname = ${name} AND conrelid = 'tenants'::regclass
		`;
		// Names and expressions are compile-time constants above, never input.
		if (!existing) {
			await db.unsafe(
				`ALTER TABLE tenants ADD CONSTRAINT ${name} CHECK (${expr})`,
			);
		}
	}
}

function quoteList(values: readonly string[]): string {
	return values.map((v) => `'${v}'`).join(", ");
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
 *  yet, allocating its `api_port` and `subnet_idx` from their sequences in the same statement
 *  (race-free — see `ensureControlSchema`). Idempotent — a concurrent
 *  second request for the same account hits a unique conflict, does nothing,
 *  and gets back the WINNING row's port (never allocates a second one), so
 *  only one caller ever calls `up(account)` for real (`provisioner.ts`).
 *  The conflict clause is targetless so EVERY unique index (account_id,
 *  acct8, subnet_idx, api_port) is an arbiter: a racing insert for the same
 *  account may trip `acct8` first, and a named `ON CONFLICT (account_id)`
 *  would raise 23505 instead of doing nothing. Throws if no row exists for
 *  the account afterwards (an acct8 collision with a different account). */
export async function insertProvisioningTenant(
	db: postgres.Sql,
	accountId: string,
	acct8: string,
): Promise<{ inserted: boolean; apiPort: number; subnetIdx: number }> {
	const inserted = await db<
		{ account_id: string; api_port: number; subnet_idx: number }[]
	>`
		INSERT INTO tenants (account_id, acct8, state)
		VALUES (${accountId}, ${acct8}, 'provisioning')
		ON CONFLICT DO NOTHING
		RETURNING account_id, api_port, subnet_idx
	`;
	if (inserted.length > 0) {
		// biome-ignore lint/style/noNonNullAssertion: length > 0 guarantees index 0
		const row = inserted[0]!;
		return { inserted: true, apiPort: row.api_port, subnetIdx: row.subnet_idx };
	}
	const existing = await getTenant(db, accountId);
	if (!existing) {
		// Nothing inserted and no row for this account: the conflict was with a
		// DIFFERENT account's acct8 (astronomically unlikely), or a `destroy()`
		// ran between the conflict and this read. Fail loudly, never return a
		// bogus port.
		throw new Error(
			`no tenant row for ${accountId} after conflict (acct8 collision with another account, or a concurrent destroy)`,
		);
	}
	return {
		inserted: false,
		apiPort: existing.api_port,
		subnetIdx: existing.subnet_idx,
	};
}

export interface TransitionTenant {
	from: readonly TenantState[];
	to: TenantState;
	/** Required exactly when `to` is `stopped`. */
	reason?: StopReason;
	/** Only move a row whose `started_at` is still this value (`null` = never
	 *  stamped). The idle stop passes the one it read, so a stack restarted in
	 *  between is left alone. */
	ifStartedAt?: Date | null;
	/** Move back to `running` without re-stamping `started_at`: undoes a stop
	 *  that did not happen. */
	keepStartedAt?: boolean;
}

/**
 * Compare-and-swap `state`: `UPDATE ... WHERE account_id = $1 AND state =
 * ANY(from)`. Returns the new row, or `null` when the row is missing or not in
 * a `from` state (a lost race: log and stop). `stopped` stamps `stopped_at`
 * and `stop_reason`; `running` stamps `started_at` and clears both. Not
 * `casTransition` from shared: that is Kysely and keys on `id`, and this DB is
 * its own raw postgres.js one keyed on `account_id`.
 */
export async function transitionTenant(
	db: postgres.Sql,
	accountId: string,
	t: TransitionTenant,
): Promise<TenantRow | null> {
	for (const from of t.from) TENANT_TRANSITIONS.assert(from, t.to);
	if ((t.to === "stopped") !== (t.reason !== undefined)) {
		throw new Error("a stop reason goes with `stopped`, and only with it");
	}
	const guard =
		t.ifStartedAt === undefined
			? db``
			: t.ifStartedAt === null
				? db`AND started_at IS NULL`
				: db`AND date_trunc('milliseconds', started_at) = ${t.ifStartedAt}`;
	const startedAt =
		t.to === "running" && !t.keepStartedAt ? db`, started_at = now()` : db``;
	const stoppedAt = t.to === "stopped" ? db`now()` : db`NULL`;
	const rows = await db<TenantRow[]>`
		UPDATE tenants
		SET state = ${t.to}, stopped_at = ${stoppedAt}, stop_reason = ${t.reason ?? null}${startedAt}
		WHERE account_id = ${accountId} AND state = ANY(${[...t.from]}) ${guard}
		RETURNING *
	`;
	return rows[0] ?? null;
}

/** Records the sha of the image a tenant's `api`/`webhook-service` just came
 *  up on (`up()`, `start()`, `upgradeTenants` in `upgrade.ts`) — read back by
 *  `upgradeTenants` to decide which `running` tenants are stale. */
export async function setTenantImageSha(
	db: postgres.Sql,
	accountId: string,
	imageSha: string,
	deploySequence: number | null = null,
): Promise<void> {
	// An unreported sequence keeps the recorded one: unknown is not "older".
	await db`
		UPDATE tenants
		SET image_sha = ${imageSha},
			image_sequence = COALESCE(${deploySequence}::bigint, image_sequence)
		WHERE account_id = ${accountId}
	`;
}

/** Records the fingerprint of the compose template a tenant just came up on —
 *  read back by `upgradeTenants` so a template-only change rolls tenants too. */
export async function setTenantTemplateSha(
	db: postgres.Sql,
	accountId: string,
	templateSha: string,
): Promise<void> {
	await db`UPDATE tenants SET template_sha = ${templateSha} WHERE account_id = ${accountId}`;
}

/** Written only by the subgraph-processor reconcile (`processor-watch.ts`). */
export async function setTenantHasSubgraphs(
	db: postgres.Sql,
	accountId: string,
	hasSubgraphs: boolean,
): Promise<void> {
	await db`UPDATE tenants SET has_subgraphs = ${hasSubgraphs} WHERE account_id = ${accountId}`;
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
 *  destroyed one is a tombstone with no stack. */
export async function listPollableTenants(
	db: postgres.Sql,
): Promise<TenantRow[]> {
	return db<TenantRow[]>`
		SELECT * FROM tenants WHERE state IN ('running', 'stopped')
		ORDER BY created_at ASC
	`;
}

/** `provisioning` tenants only — at boot, every one is orphaned by a restart
 *  mid-`up()` (`provisioner.ts`'s `recoverInterruptedProvisions`). */
export async function listProvisioningTenants(
	db: postgres.Sql,
): Promise<TenantRow[]> {
	return db<TenantRow[]>`
		SELECT * FROM tenants WHERE state = 'provisioning'
		ORDER BY created_at ASC
	`;
}

/** `YYYY-MM-DD` of `now` in UTC: the day a storage sample belongs to
 *  (`storageIdempotencyKey` uses the same day). */
export function utcDay(now: Date): string {
	return now.toISOString().slice(0, 10);
}

/** Running tenants with no storage sample for the current UTC day. */
export async function listTenantsDueStorageSample(
	db: postgres.Sql,
	now: Date,
): Promise<TenantRow[]> {
	return db<TenantRow[]>`
		SELECT * FROM tenants
		WHERE state = 'running'
			AND (last_storage_sample_day IS NULL OR last_storage_sample_day < ${utcDay(now)}::date)
		ORDER BY created_at ASC
	`;
}

export async function markStorageSampled(
	db: postgres.Sql,
	accountId: string,
	now: Date,
): Promise<void> {
	await db`UPDATE tenants SET last_storage_sample_day = ${utcDay(now)}::date WHERE account_id = ${accountId}`;
}

/** Running or stopped tenants (a stopped stack keeps its postgres) whose last
 *  dump predates the current UTC day. */
export async function listTenantsDueBackup(
	db: postgres.Sql,
	now: Date,
): Promise<TenantRow[]> {
	const startOfUtcDay = new Date(`${utcDay(now)}T00:00:00.000Z`);
	return db<TenantRow[]>`
		SELECT * FROM tenants
		WHERE state IN ('running', 'stopped')
			AND (last_backup_at IS NULL OR last_backup_at < ${startOfUtcDay})
		ORDER BY created_at ASC
	`;
}

export async function markBackedUp(
	db: postgres.Sql,
	accountId: string,
	at: Date,
): Promise<void> {
	await db`UPDATE tenants SET last_backup_at = ${at} WHERE account_id = ${accountId}`;
}

/** Tenants with no good dump inside `maxAgeMs`: older than that, or never
 *  dumped and created longer ago than that. */
export async function listTenantsWithStaleBackup(
	db: postgres.Sql,
	now: Date,
	maxAgeMs: number,
): Promise<TenantRow[]> {
	const cutoff = new Date(now.getTime() - maxAgeMs);
	return db<TenantRow[]>`
		SELECT * FROM tenants
		WHERE state IN ('running', 'stopped')
			AND COALESCE(last_backup_at, created_at) < ${cutoff}
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
