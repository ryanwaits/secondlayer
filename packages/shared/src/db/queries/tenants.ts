import type { Kysely } from "kysely";
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
	trialEndsAt: Date;
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
		trial_ends_at: input.trialEndsAt,
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

export async function listExpiredTrials(
	db: Kysely<Database>,
	now = new Date(),
): Promise<Tenant[]> {
	return db
		.selectFrom("tenants")
		.selectAll()
		.where("status", "in", ["provisioning", "active"])
		.where("trial_ends_at", "<", now)
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
	if (status === "suspended") patch.suspended_at = new Date();
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
