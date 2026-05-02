import { type Kysely, sql } from "kysely";
import { decryptSecret, encryptSecret } from "../../crypto/secrets.ts";
import type { Database, InsertTenant, Tenant, TenantStatus } from "../types.ts";

/**
 * Tenant registry queries. Encrypted columns are stored as `bytea` and
 * transparently encrypted/decrypted via `encryptSecret`/`decryptSecret`.
 *
 * Never return decrypted values from listTenants — only `getTenantCredentials`
 * surfaces plaintext, and only when explicitly called by a caller that
 * needs to hand creds to a CLI or dashboard session.
 */

export interface NewTenantInput {
	accountId: string;
	slug: string;
	plan: string;
	cpus: number;
	memoryMb: number;
	storageLimitMb: number;
	pgContainerId: string;
	apiContainerId: string;
	processorContainerId: string;
	targetDatabaseUrl: string;
	tenantJwtSecret: string;
	anonKey: string;
	serviceKey: string;
	apiUrlInternal: string;
	apiUrlPublic: string;
	projectId?: string;
}

export async function insertTenant(
	db: Kysely<Database>,
	input: NewTenantInput,
): Promise<Tenant> {
	const row: InsertTenant = {
		account_id: input.accountId,
		slug: input.slug,
		status: "active",
		plan: input.plan,
		cpus: input.cpus,
		memory_mb: input.memoryMb,
		storage_limit_mb: input.storageLimitMb,
		pg_container_id: input.pgContainerId,
		api_container_id: input.apiContainerId,
		processor_container_id: input.processorContainerId,
		target_database_url_enc: encryptSecret(input.targetDatabaseUrl),
		tenant_jwt_secret_enc: encryptSecret(input.tenantJwtSecret),
		anon_key_enc: encryptSecret(input.anonKey),
		service_key_enc: encryptSecret(input.serviceKey),
		api_url_internal: input.apiUrlInternal,
		api_url_public: input.apiUrlPublic,
		project_id: input.projectId ?? null,
	};
	return db
		.insertInto("tenants")
		.values(row)
		.returningAll()
		.executeTakeFirstOrThrow();
}

export async function getTenantByAccount(
	db: Kysely<Database>,
	accountId: string,
): Promise<Tenant | null> {
	const row = await db
		.selectFrom("tenants")
		.selectAll()
		.where("account_id", "=", accountId)
		.where("status", "<>", "deleted")
		.orderBy("created_at", "desc")
		.executeTakeFirst();
	return row ?? null;
}

export async function getTenantBySlug(
	db: Kysely<Database>,
	slug: string,
): Promise<Tenant | null> {
	const row = await db
		.selectFrom("tenants")
		.selectAll()
		.where("slug", "=", slug)
		.executeTakeFirst();
	return row ?? null;
}

export async function listTenantsByStatus(
	db: Kysely<Database>,
	status: TenantStatus,
): Promise<Tenant[]> {
	return db
		.selectFrom("tenants")
		.selectAll()
		.where("status", "=", status)
		.execute();
}

/**
 * Tenants considered "idle" for auto-pause on the Hobby tier. Active =
 * any successful tenant-API request bumped `last_active_at` within the
 * threshold.
 */
export async function listIdleHobbyTenants(
	db: Kysely<Database>,
	idleSince: Date,
): Promise<Tenant[]> {
	return db
		.selectFrom("tenants")
		.selectAll()
		.where("status", "in", ["active", "limit_warning"])
		.where("plan", "=", "hobby")
		.where("last_active_at", "<", idleSince)
		.execute();
}

/**
 * Bump `last_active_at` for a tenant. Callers are expected to throttle
 * (don't hammer on every request) — the tenant-API activity middleware
 * enforces a 60s per-tenant min between writes.
 */
export async function bumpTenantActivity(
	db: Kysely<Database>,
	slug: string,
): Promise<void> {
	await db
		.updateTable("tenants")
		.set({ last_active_at: new Date() })
		.where("slug", "=", slug)
		.execute();
}

export async function listSuspendedOlderThan(
	db: Kysely<Database>,
	olderThan: Date,
): Promise<Tenant[]> {
	return db
		.selectFrom("tenants")
		.selectAll()
		.where("status", "=", "suspended")
		.where("suspended_at", "<", olderThan)
		.execute();
}

export async function setTenantStatus(
	db: Kysely<Database>,
	slug: string,
	status: TenantStatus,
): Promise<void> {
	const patch: Record<string, unknown> = {
		status,
		updated_at: new Date(),
	};
	if (status === "suspended" || status === "paused_limit") {
		patch.suspended_at = new Date();
	}
	if (status === "active") patch.suspended_at = null;
	await db.updateTable("tenants").set(patch).where("slug", "=", slug).execute();
}

export async function recordHealthCheck(
	db: Kysely<Database>,
	slug: string,
	storageUsedMb: number | null,
): Promise<void> {
	await db
		.updateTable("tenants")
		.set({
			last_health_check_at: new Date(),
			storage_used_mb: storageUsedMb,
			updated_at: new Date(),
		})
		.where("slug", "=", slug)
		.execute();
}

/**
 * Record a storage measurement into the current calendar month's bucket.
 * Maintains peak, running average, and the most recent value in a single
 * upsert. Billing will consume this later; for now the table just gives
 * us evidence of usage over time.
 */
export async function recordMonthlyUsage(
	db: Kysely<Database>,
	tenantId: string,
	storageMb: number,
): Promise<void> {
	// Bucket is the first day of the current month (UTC), so the unique
	// (tenant_id, period_month) constraint groups all samples cleanly.
	const now = new Date();
	const periodMonth = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
	);

	// Running mean: avg_new = (avg_old * n + x) / (n + 1). Doing it in SQL
	// keeps the write atomic — no read-modify-write race between ticks.
	await sql`
		INSERT INTO tenant_usage_monthly (
			tenant_id, period_month,
			storage_peak_mb, storage_avg_mb, storage_last_mb,
			measurements, first_at, last_at
		) VALUES (
			${tenantId}, ${periodMonth},
			${storageMb}, ${storageMb}, ${storageMb},
			1, now(), now()
		)
		ON CONFLICT (tenant_id, period_month) DO UPDATE SET
			storage_peak_mb = GREATEST(tenant_usage_monthly.storage_peak_mb, EXCLUDED.storage_last_mb),
			storage_avg_mb = (
				(tenant_usage_monthly.storage_avg_mb * tenant_usage_monthly.measurements + EXCLUDED.storage_last_mb)
				/ (tenant_usage_monthly.measurements + 1)
			),
			storage_last_mb = EXCLUDED.storage_last_mb,
			measurements = tenant_usage_monthly.measurements + 1,
			last_at = now()
	`.execute(db);
}

export async function updateTenantPlan(
	db: Kysely<Database>,
	slug: string,
	plan: string,
	cpus: number,
	memoryMb: number,
	storageLimitMb: number,
): Promise<void> {
	await db
		.updateTable("tenants")
		.set({
			plan,
			cpus,
			memory_mb: memoryMb,
			storage_limit_mb: storageLimitMb,
			updated_at: new Date(),
		})
		.where("slug", "=", slug)
		.execute();
}

export type RotateType = "service" | "anon" | "both";

/**
 * Bump the selected gen counter(s) by 1 and return the new values.
 * Used by the key-rotate endpoint to force the tenant API to reject
 * previously-issued tokens of the rotated role(s).
 */
export async function bumpTenantKeyGen(
	db: Kysely<Database>,
	slug: string,
	type: RotateType,
): Promise<{ serviceGen: number; anonGen: number }> {
	const bumpService = type === "service" || type === "both";
	const bumpAnon = type === "anon" || type === "both";
	const row = await db
		.updateTable("tenants")
		.set((eb) => ({
			service_gen: bumpService
				? eb("service_gen", "+", 1)
				: eb.ref("service_gen"),
			anon_gen: bumpAnon ? eb("anon_gen", "+", 1) : eb.ref("anon_gen"),
			updated_at: new Date(),
		}))
		.where("slug", "=", slug)
		.returning(["service_gen", "anon_gen"])
		.executeTakeFirstOrThrow();
	return { serviceGen: row.service_gen, anonGen: row.anon_gen };
}

/**
 * Replace the encrypted key columns after a successful rotate. Only the
 * rotated column(s) are written — the other stays untouched.
 */
export async function updateTenantKeys(
	db: Kysely<Database>,
	slug: string,
	keys: { serviceKey?: string; anonKey?: string },
): Promise<void> {
	const patch: Record<string, unknown> = { updated_at: new Date() };
	if (keys.serviceKey) patch.service_key_enc = encryptSecret(keys.serviceKey);
	if (keys.anonKey) patch.anon_key_enc = encryptSecret(keys.anonKey);
	if (Object.keys(patch).length === 1) return; // only updated_at — nothing to write
	await db.updateTable("tenants").set(patch).where("slug", "=", slug).execute();
}

/**
 * Hard-delete a tenant row. Call only AFTER the provisioner has torn down
 * containers + volume; otherwise orphaned resources linger. Returns whether
 * a row was actually deleted.
 */
export async function deleteTenant(
	db: Kysely<Database>,
	slug: string,
): Promise<boolean> {
	const res = await db
		.deleteFrom("tenants")
		.where("slug", "=", slug)
		.executeTakeFirst();
	return (res.numDeletedRows ?? 0n) > 0n;
}

export interface TenantCredentials {
	slug: string;
	targetDatabaseUrl: string;
	tenantJwtSecret: string;
	anonKey: string;
	serviceKey: string;
	apiUrlInternal: string;
	apiUrlPublic: string;
}

/**
 * Decrypts the four encrypted columns and returns them plaintext. Call
 * this only when surfacing credentials to an authorized caller (dashboard,
 * CLI). Never log the returned object.
 */
export async function getTenantCredentials(
	db: Kysely<Database>,
	slug: string,
): Promise<TenantCredentials | null> {
	const row = await db
		.selectFrom("tenants")
		.select([
			"slug",
			"target_database_url_enc",
			"tenant_jwt_secret_enc",
			"anon_key_enc",
			"service_key_enc",
			"api_url_internal",
			"api_url_public",
		])
		.where("slug", "=", slug)
		.executeTakeFirst();
	if (!row) return null;
	return {
		slug: row.slug,
		targetDatabaseUrl: decryptSecret(row.target_database_url_enc),
		tenantJwtSecret: decryptSecret(row.tenant_jwt_secret_enc),
		anonKey: decryptSecret(row.anon_key_enc),
		serviceKey: decryptSecret(row.service_key_enc),
		apiUrlInternal: row.api_url_internal,
		apiUrlPublic: row.api_url_public,
	};
}
