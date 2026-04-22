import { type Kysely, sql } from "kysely";
import type { Database, TenantComputeAddon } from "../types.ts";

/**
 * Compute add-ons — extras on top of a plan's base spec.
 *
 * Effective compute is NEVER derived from just the `tenants.plan`
 * column — always run `computeEffectiveCompute(tenantId, planBase)`
 * to fold in active add-ons. Provisioning, resize, and Stripe metering
 * all share this source of truth.
 */

/** Active = open-ended (effective_until IS NULL) OR not yet expired. */
export async function listActiveAddonsForTenant(
	db: Kysely<Database>,
	tenantId: string,
	now: Date = new Date(),
): Promise<TenantComputeAddon[]> {
	return db
		.selectFrom("tenant_compute_addons")
		.selectAll()
		.where("tenant_id", "=", tenantId)
		.where("effective_from", "<=", now)
		.where((eb) =>
			eb.or([
				eb("effective_until", "is", null),
				eb("effective_until", ">", now),
			]),
		)
		.execute();
}

export interface ComputeSpec {
	cpus: number;
	memoryMb: number;
	storageLimitMb: number;
}

/**
 * Apply active add-ons on top of a base spec. `storageLimitMb` of -1
 * (enterprise unlimited) passes through unchanged — add-ons don't
 * further modify unlimited storage.
 */
export async function computeEffectiveCompute(
	db: Kysely<Database>,
	tenantId: string,
	base: ComputeSpec,
	now: Date = new Date(),
): Promise<ComputeSpec> {
	const row = await db
		.selectFrom("tenant_compute_addons")
		.select([
			sql<number>`coalesce(sum(memory_mb_delta), 0)`.as("mem_delta"),
			sql<string>`coalesce(sum(cpu_delta), 0)`.as("cpu_delta"),
			sql<number>`coalesce(sum(storage_mb_delta), 0)`.as("stor_delta"),
		])
		.where("tenant_id", "=", tenantId)
		.where("effective_from", "<=", now)
		.where((eb) =>
			eb.or([
				eb("effective_until", "is", null),
				eb("effective_until", ">", now),
			]),
		)
		.executeTakeFirst();

	if (!row) return base;

	const cpus = base.cpus + Number(row.cpu_delta ?? 0);
	const memoryMb = base.memoryMb + Number(row.mem_delta ?? 0);
	const storageLimitMb =
		base.storageLimitMb === -1
			? -1
			: base.storageLimitMb + Number(row.stor_delta ?? 0);

	return { cpus, memoryMb, storageLimitMb };
}
