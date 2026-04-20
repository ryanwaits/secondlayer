import type { Kysely } from "kysely";
import type {
	Database,
	InsertProvisioningAuditLog,
	ProvisioningAuditEvent,
	ProvisioningAuditLog,
	ProvisioningAuditStatus,
} from "../types.ts";

/**
 * Provisioning audit trail — every lifecycle event that mutates a tenant
 * lands here. Write on both happy and sad paths so we can reconstruct
 * what was attempted and what failed.
 *
 * `actor` is the logical source (e.g. `account:<uuid>`, `worker:tenant-health`,
 * `admin:<uuid>`). Keep it grep-able — this is the only breadcrumb when
 * something goes sideways.
 */

export interface AuditInput {
	tenantId?: string | null;
	tenantSlug?: string | null;
	accountId?: string | null;
	actor: string;
	event: ProvisioningAuditEvent;
	status: ProvisioningAuditStatus;
	detail?: unknown;
	error?: string;
}

export async function recordProvisioningAudit(
	db: Kysely<Database>,
	input: AuditInput,
): Promise<void> {
	const row: InsertProvisioningAuditLog = {
		tenant_id: input.tenantId ?? null,
		tenant_slug: input.tenantSlug ?? null,
		account_id: input.accountId ?? null,
		actor: input.actor,
		event: input.event,
		status: input.status,
		detail: input.detail ?? null,
		error: input.error ?? null,
	};
	await db.insertInto("provisioning_audit_log").values(row).execute();
}

export async function listAuditForTenant(
	db: Kysely<Database>,
	tenantId: string,
	limit = 50,
): Promise<ProvisioningAuditLog[]> {
	return db
		.selectFrom("provisioning_audit_log")
		.selectAll()
		.where("tenant_id", "=", tenantId)
		.orderBy("created_at", "desc")
		.limit(limit)
		.execute();
}
